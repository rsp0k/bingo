"use client"

import { useEffect, useState, useRef } from "react"
import { doc, updateDoc, onSnapshot, collection, getDocs, query, where, getDoc, runTransaction } from "firebase/firestore"
import { db } from "@/lib/firebase"
import type { Draw, Card as BingoCard } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Trophy, Clock } from "lucide-react"
import { creditUserPrize, calculatePrize, checkCardWinner as checkCardWinnerUtil } from "@/lib/prize-utils"

interface AutomaticDrawEngineProps {
  drawId: string
  isActive: boolean
}

interface Winner {
  userId: string
  userName: string
  cardId: string
  type: "quadra" | "quina" | "cheia"
  prize: number
}

export function AutomaticDrawEngine({ drawId, isActive }: AutomaticDrawEngineProps) {
  const [draw, setDraw] = useState<Draw | null>(null)
  const [winners, setWinners] = useState<Winner[]>([])
  const [showWinnerModal, setShowWinnerModal] = useState(false)
  const [currentWinners, setCurrentWinners] = useState<Winner[]>([])
  const [winnerTimer, setWinnerTimer] = useState(10)
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null)
  const isDrawingRef = useRef(false)
  const { toast } = useToast()
  const announcedWinnersRef = useRef(new Set<string>())

  // Função para sortear um número
  const drawNumber = async (currentDraw: Draw) => {
    try {
      console.log("Drawing a number...")

      // Obter números já sorteados
      const drawDoc = await getDoc(doc(db, "draws", drawId))
      const drawData = drawDoc.data()
      const currentDrawnNumbers = drawData?.drawnNumbers || []

      // Verificar números disponíveis
      const allNumbers = Array.from({ length: 90 }, (_, i) => i + 1)
      const availableNumbers = allNumbers.filter((num) => !currentDrawnNumbers.includes(num))

      if (availableNumbers.length === 0) {
        console.log("No more numbers to draw")

        // Finalizar o sorteio
        await updateDoc(doc(db, "draws", drawId), {
          status: "finished",
        })

        return
      }

      // Sortear um número aleatório
      const randomIndex = Math.floor(Math.random() * availableNumbers.length)
      const drawnNumber = availableNumbers[randomIndex]

      console.log(`Drawn number: ${drawnNumber}`)

      // Atualizar no Firestore
      const newDrawnNumbers = [...currentDrawnNumbers, drawnNumber]
      await updateDoc(doc(db, "draws", drawId), {
        drawnNumbers: newDrawnNumbers,
      })

      // Verificar ganhadores
      await checkWinners(newDrawnNumbers, currentDraw)
    } catch (error) {
      console.error("Error drawing number:", error)
    }
  }

  // Efeito para monitorar o sorteio
  useEffect(() => {
    console.log("Setting up draw listener")

    // Listener para mudanças no sorteio
    const unsubscribe = onSnapshot(doc(db, "draws", drawId), (docSnapshot) => {
      if (docSnapshot.exists()) {
        const drawData = {
          id: docSnapshot.id,
          ...docSnapshot.data(),
          dateTime: docSnapshot.data().dateTime.toDate(),
          createdAt: docSnapshot.data().createdAt.toDate(),
        } as Draw

        setDraw(drawData)

        // Iniciar ou parar o sorteio automático com base no status
        if (drawData.status === "active" && drawData.mode === "automatic") {
          if (!isDrawingRef.current) {
            console.log("Starting automatic draw")
            isDrawingRef.current = true

            // Limpar qualquer intervalo existente
            if (intervalIdRef.current) {
              clearInterval(intervalIdRef.current)
            }

            // Configurar novo intervalo
            intervalIdRef.current = setInterval(() => {
              drawNumber(drawData)
            }, 3000)

            // Sortear o primeiro número imediatamente
            drawNumber(drawData)
          }
        } else if (isDrawingRef.current) {
          console.log("Stopping automatic draw")
          isDrawingRef.current = false

          if (intervalIdRef.current) {
            clearInterval(intervalIdRef.current)
            intervalIdRef.current = null
          }
        }
      }
    })

    // Limpar na desmontagem
    return () => {
      console.log("Cleaning up draw listener")
      unsubscribe()

      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current)
        intervalIdRef.current = null
      }

      isDrawingRef.current = false
    }
  }, [drawId])

  const checkWinners = async (currentDrawnNumbers: number[], currentDraw: Draw) => {
    if (!currentDraw) return;

    try {
      // Usar transação para garantir consistência
      await runTransaction(db, async (transaction) => {
        // Obter dados atualizados do sorteio dentro da transação
        const drawRef = doc(db, "draws", currentDraw.id);
        const drawDoc = await transaction.get(drawRef);
        
        if (!drawDoc.exists()) {
          console.log("Sorteio não encontrado");
          return;
        }
        
        const drawData = drawDoc.data();
        const currentPhase = drawData.currentPhase as "quadra" | "quina" | "cheia";
        const winners = { ...(drawData.winners || {}) };
        
        // Se já existe um ganhador para a fase atual, não faz nada
        if (winners[currentPhase] && winners[currentPhase].length > 0) {
          console.log(`Já existe ganhador para ${currentPhase}. Ignorando.`);
          return;
        }
        
        // Buscar todas as cartelas do sorteio
        const cardsQuery = query(collection(db, "cards"), where("drawId", "==", currentDraw.id));
        const cardsSnapshot = await getDocs(cardsQuery);
        
        // Filtrar cartelas elegíveis com base na fase atual
        const cardsData = cardsSnapshot.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data() 
        })) as BingoCard[];
        
        const cartelasElegiveis = cardsData.filter(card => {
          // Na fase quadra, todas as cartelas são elegíveis
          if (currentPhase === "quadra") return true;
          
          // Na fase quina, cartelas que ganharam quadra NÃO são elegíveis
          if (currentPhase === "quina") {
            return !(winners.quadra || []).includes(card.id);
          }
          
          // Na fase cheia, cartelas que ganharam quadra ou quina NÃO são elegíveis
          if (currentPhase === "cheia") {
            return !(winners.quadra || []).includes(card.id) && 
                   !(winners.quina || []).includes(card.id);
          }
          
          return false;
        });
        
        console.log(`Fase atual: ${currentPhase}, Cartelas elegíveis: ${cartelasElegiveis.length}`);
        
        // Verificar se alguma cartela elegível ganhou o prêmio da fase atual
        let cartela_vencedora: BingoCard | null = null;
        
        // IMPORTANTE: Só verifica o tipo de prêmio da fase atual
        if (currentPhase === "quadra") {
          cartela_vencedora = cartelasElegiveis.find(card => {
            const result = checkCardWinnerUtil(card, currentDrawnNumbers);
            return result === "quadra" || result === "quina" || result === "cheia";
          }) || null;
        } 
        else if (currentPhase === "quina") {
          cartela_vencedora = cartelasElegiveis.find(card => {
            const result = checkCardWinnerUtil(card, currentDrawnNumbers);
            return result === "quina" || result === "cheia";
          }) || null;
        }
        else if (currentPhase === "cheia") {
          cartela_vencedora = cartelasElegiveis.find(card => {
            const result = checkCardWinnerUtil(card, currentDrawnNumbers);
            return result === "cheia";
          }) || null;
        }
        
        // Se encontrou um ganhador, registrar e avançar fase
        if (cartela_vencedora) {
          // Preparar objeto de winners (preservando winners anteriores)
          const updatedWinners = { ...winners };
          
          // Adicionar o ganhador atual
          if (!updatedWinners[currentPhase]) {
            updatedWinners[currentPhase] = [];
          }
          
          // Garantir que não há duplicatas
          if (!updatedWinners[currentPhase].includes(cartela_vencedora.id)) {
            updatedWinners[currentPhase] = [cartela_vencedora.id];
            
            // Determinar próxima fase
            let proximaFase = currentPhase;
            if (currentPhase === "quadra") proximaFase = "quina";
            else if (currentPhase === "quina") proximaFase = "cheia";
            
            // Atualizar no Firestore dentro da transação
            transaction.update(drawRef, {
              winners: updatedWinners,
              currentPhase: proximaFase
            });
            
            // Buscar dados do usuário para exibir no modal
            const userDoc = await getDoc(doc(db, "users", cartela_vencedora.userId));
            const userData = userDoc.exists() ? userDoc.data() : null;
            const userName = userData?.name || "";
            
            const prize = calculatePrize(currentPhase, currentDraw);
            
            // === CREDITAR SALDO DO USUÁRIO VENCEDOR ===
            if (userData && prize > 0) {
              const success = await creditUserPrize(
                cartela_vencedora.userId,
                prize,
                currentPhase,
                cartela_vencedora.id
              );
              
              if (success) {
                toast({
                  title: "🎉 Prêmio Creditado!",
                  description: `${userName} ganhou R$ ${prize.toFixed(2)} na ${currentPhase}!`,
                });
              }
            }
            
            const winner: Winner = {
              userId: cartela_vencedora.userId,
              userName,
              cardId: cartela_vencedora.id,
              type: currentPhase,
              prize
            };
            
            // Adicionar ao estado para exibir no modal
            setWinners(prev => [...prev, winner]);
            
            // Marcar como anunciado
            announcedWinnersRef.current.add(cartela_vencedora.id + '-' + currentPhase);
            
            // Exibir modal
            setCurrentWinners([winner]);
            setShowWinnerModal(true);
            
            console.log(`Registrado ganhador para ${currentPhase}: Cartela ${cartela_vencedora.id.slice(-4).toUpperCase()}`);
            console.log(`Fase avançada para: ${proximaFase}`);
          }
        }
      });
    } catch (error) {
      console.error("Erro ao verificar ganhadores:", error);
    }
  };



  const getWinnerTypeBadge = (type: "quadra" | "quina" | "cheia") => {
    switch (type) {
      case "quadra":
        return <Badge className="bg-yellow-100 text-yellow-800">Quadra</Badge>
      case "quina":
        return <Badge className="bg-blue-100 text-blue-800">Quina</Badge>
      case "cheia":
        return <Badge className="bg-green-100 text-green-800">Cartela Cheia</Badge>
    }
  }

  if (!draw || draw.mode !== "automatic") {
    return null
  }

  return (
    <>
      {/* Indicador de Status do Sorteio */}
      {draw.status === "active" && isDrawingRef.current && (
        <div className="fixed top-4 left-4 z-50">
          <div className="bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
              <span className="text-sm font-medium">Sorteio Automático Ativo</span>
            </div>
          </div>
        </div>
      )}

      {/* Debug Info - Remover em produção */}
      {process.env.NODE_ENV !== "production" && (
        <div className="fixed bottom-4 left-4 z-50 bg-black text-white p-2 rounded text-xs">
          <div>Status: {draw.status}</div>
          <div>Mode: {draw.mode}</div>
          <div>Drawing: {isDrawingRef.current ? "Yes" : "No"}</div>
          <div>Numbers: {draw.drawnNumbers?.length || 0}/90</div>
        </div>
      )}
    </>
  )
}
