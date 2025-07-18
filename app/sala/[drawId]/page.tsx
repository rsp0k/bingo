"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter, useParams } from "next/navigation"
import { doc, getDoc, collection, getDocs, query, where, onSnapshot, updateDoc, runTransaction } from "firebase/firestore"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { UserLayout } from "@/components/layout/user-layout"
import { AutomaticDrawEngine } from "@/components/automatic-draw-engine"
import { useAuth } from "@/hooks/use-auth"
import { db } from "@/lib/firebase"
import type { Draw, Card as BingoCard } from "@/lib/types"
import { Clock, Trophy, Users, ArrowLeft, History } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { WinnerModal } from "@/components/WinnerModal"

interface Winner {
  userId: string;
  userName: string;
  cardId: string;
  type: "quadra" | "quina" | "cheia";
  prize: number;
}

export default function DrawRoomPage() {
  const { user, loading } = useAuth()
  const [draw, setDraw] = useState<Draw | null>(null)
  const [userCards, setUserCards] = useState<BingoCard[]>([])
  const [loadingDraw, setLoadingDraw] = useState(true)
  const [drawnNumbers, setDrawnNumbers] = useState<number[]>([])
  const [timeUntilStart, setTimeUntilStart] = useState<string>("")
  const [lastDrawnNumber, setLastDrawnNumber] = useState<number | null>(null)
  const router = useRouter()
  const params = useParams()
  const { toast } = useToast()
  const drawId = params.drawId as string
  const [showWinnerModal, setShowWinnerModal] = useState(false)
  const [winnerInfo, setWinnerInfo] = useState<Winner[] | null>(null)
  const lastWinnersRef = useRef({ quadra: new Set<string>(), quina: new Set<string>(), cheia: new Set<string>() })
  const lastShownWinnerRef = useRef({ quadra: '', quina: '', cheia: '' });

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login")
    }
  }, [user, loading, router])

  useEffect(() => {
    const fetchDrawAndCards = async () => {
      if (!user) return

      try {
        // Buscar informações do sorteio
        const drawDoc = await getDoc(doc(db, "draws", drawId))
        if (!drawDoc.exists()) {
          toast({
            title: "Sorteio não encontrado",
            description: "O sorteio solicitado não existe.",
            variant: "destructive",
          })
          router.push("/home")
          return
        }

        const drawData = {
          id: drawDoc.id,
          ...drawDoc.data(),
          dateTime: drawDoc.data().dateTime.toDate(),
          createdAt: drawDoc.data().createdAt.toDate(),
        } as Draw

        setDraw(drawData)
        setDrawnNumbers(drawData.drawnNumbers || [])

        if (drawData.drawnNumbers && drawData.drawnNumbers.length > 0) {
          setLastDrawnNumber(drawData.drawnNumbers[drawData.drawnNumbers.length - 1])
        }

        // Buscar cartelas do usuário para este sorteio
        const cardsQuery = query(collection(db, "cards"), where("userId", "==", user.id), where("drawId", "==", drawId))
        const cardsSnapshot = await getDocs(cardsQuery)
        const cardsData = cardsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          purchaseDate: doc.data().purchaseDate.toDate(),
        })) as BingoCard[]

        if (cardsData.length === 0) {
          toast({
            title: "Acesso negado",
            description: "Você precisa comprar cartelas para acessar esta sala.",
            variant: "destructive",
          })
          router.push("/home")
          return
        }

        setUserCards(cardsData)
      } catch (error) {
        console.error("Error fetching draw and cards:", error)
        toast({
          title: "Erro",
          description: "Não foi possível carregar a sala do sorteio.",
          variant: "destructive",
        })
      } finally {
        setLoadingDraw(false)
      }
    }

    fetchDrawAndCards()
  }, [user, drawId, router, toast])

  // Adicionar um novo useEffect separado para o listener em tempo real
  useEffect(() => {
    if (!user) return

    console.log("Setting up real-time listener for draw updates")

    // Escutar atualizações em tempo real do sorteio
    const unsubscribe = onSnapshot(
      doc(db, "draws", drawId),
      (docSnapshot) => {
        console.log("Received real-time update from Firestore")

        if (docSnapshot.exists()) {
          const updatedDraw = {
            id: docSnapshot.id,
            ...docSnapshot.data(),
            dateTime: docSnapshot.data().dateTime.toDate(),
            createdAt: docSnapshot.data().createdAt.toDate(),
          } as Draw

          console.log("Updated draw data:", updatedDraw.drawnNumbers?.length)
          setDraw(updatedDraw)

          // Atualizar números sorteados
          const newDrawnNumbers = updatedDraw.drawnNumbers || []

          // Verificar se há um novo número sorteado
          if (newDrawnNumbers.length > 0) {
            const newNumber = newDrawnNumbers[newDrawnNumbers.length - 1]
            console.log("Last drawn number:", newNumber)
            setLastDrawnNumber(newNumber)
          }

          setDrawnNumbers(newDrawnNumbers)

          // Lógica simplificada para exibição de ganhadores
          if (updatedDraw.winners) {
            const winnerTypes = ["quadra", "quina", "cheia"] as const;
            
            // Verificar se há algum ganhador novo
            let hasNewWinner = false;
            for (const type of winnerTypes) {
              const currentWinners = (updatedDraw.winners as Record<string, string[]>)[type] || [];
              if (currentWinners.length > 0) {
                const cardId = currentWinners[0];
                if (lastShownWinnerRef.current[type] !== cardId) {
                  hasNewWinner = true;
                  lastShownWinnerRef.current[type] = cardId;
                }
              }
            }
            
            // Se houver um novo ganhador, buscar todos os ganhadores para exibir no modal
            if (hasNewWinner) {
              (async () => {
                try {
                  const allWinners: Winner[] = [];
                  
                  // Buscar todos os ganhadores de todas as fases
                  for (const type of winnerTypes) {
                    const winnerCards = (updatedDraw.winners as Record<string, string[]>)[type] || [];
                    
                    for (const cardId of winnerCards) {
                      // Buscar dados da cartela
                      const cardDoc = await getDoc(doc(db, "cards", cardId));
                      if (!cardDoc.exists()) continue;
                      
                      const cardData = cardDoc.data();
                      const userId = cardData.userId;
                      
                      // Buscar dados do usuário
                      const userDoc = await getDoc(doc(db, "users", userId));
                      const userName = userDoc.exists() ? userDoc.data().name : "Usuário";
                      
                      // Calcular prêmio
                      const prize = updatedDraw.type === "fixed"
                        ? (updatedDraw.prizes as any)[type]
                        : 100; // Valor padrão para sorteios não fixos
                      
                      // Adicionar à lista de ganhadores
                      allWinners.push({
                        userId,
                        userName,
                        cardId,
                        type,
                        prize
                      });
                    }
                  }
                  
                  // Se encontrou ganhadores, exibir o modal
                  if (allWinners.length > 0) {
                    setWinnerInfo(allWinners);
                    setShowWinnerModal(true);
                    console.log(`Exibindo modal com ${allWinners.length} ganhadores`);
                  }
                } catch (error) {
                  console.error("Erro ao buscar dados dos ganhadores:", error);
                }
              })();
            }
          }
        }
      },
      (error) => {
        console.error("Error in real-time listener:", error)
      },
    )

    return () => {
      console.log("Cleaning up real-time listener")
      unsubscribe()
    }
  }, [user, drawId])

  // Timer para contagem regressiva
  useEffect(() => {
    if (!draw) return

    const updateTimer = () => {
      const now = new Date()
      const diff = draw.dateTime.getTime() - now.getTime()

      if (diff <= 0) {
        setTimeUntilStart("Iniciando...")
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60))
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((diff % (1000 * 60)) / 1000)
        setTimeUntilStart(`${hours}h ${minutes}m ${seconds}s`)
      }
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)

    return () => clearInterval(interval)
  }, [draw])

  const isNumberMarked = (number: number): boolean => {
    return drawnNumbers.includes(number)
  }

  const getMarkedCount = (card: BingoCard): number => {
    let count = 0
    card.numbers.forEach((number, index) => {
      const row = Math.floor(index / 5)
      const col = index % 5
      const isFree = col === 2 && row === 2

      if (isFree || isNumberMarked(number)) {
        count++
      }
    })
    return count
  }

  const getCardStatus = (card: BingoCard): string => {
    // Lógica igual ao checkCardWinner
    // Verificar se a cartela está cheia (todos os números marcados)
    let totalMarked = 0;
    card.numbers.forEach((number, index) => {
      const row = Math.floor(index / 5);
      const col = index % 5;
      const isFree = col === 2 && row === 2;
      if (isFree || isNumberMarked(number)) {
        totalMarked++;
      }
    });
    if (totalMarked === 25) return "CARTELA CHEIA!";

    // Verificar linhas para quina ou quadra
    let foundQuina = false;
    let foundQuadra = false;
    for (let row = 0; row < 5; row++) {
      let markedInRow = 0;
      for (let col = 0; col < 5; col++) {
        const index = row * 5 + col;
        const number = card.numbers[index];
        const isFree = col === 2 && row === 2;
        if (isFree || isNumberMarked(number)) {
          markedInRow++;
        }
      }
      if (markedInRow === 5) foundQuina = true;
      else if (markedInRow === 4) foundQuadra = true;
    }
    if (foundQuina) return "QUINA!";
    if (foundQuadra) return "QUADRA!";
    return `${totalMarked}/25 marcados`;
  }

  const getCardStatusColor = (card: BingoCard): string => {
    // Lógica igual ao getCardStatus
    let totalMarked = 0;
    card.numbers.forEach((number, index) => {
      const row = Math.floor(index / 5);
      const col = index % 5;
      const isFree = col === 2 && row === 2;
      if (isFree || isNumberMarked(number)) {
        totalMarked++;
      }
    });
    if (totalMarked === 25) return "text-green-600 font-bold";
    let foundQuina = false;
    let foundQuadra = false;
    for (let row = 0; row < 5; row++) {
      let markedInRow = 0;
      for (let col = 0; col < 5; col++) {
        const index = row * 5 + col;
        const number = card.numbers[index];
        const isFree = col === 2 && row === 2;
        if (isFree || isNumberMarked(number)) {
          markedInRow++;
        }
      }
      if (markedInRow === 5) foundQuina = true;
      else if (markedInRow === 4) foundQuadra = true;
    }
    if (foundQuina) return "text-blue-600 font-bold";
    if (foundQuadra) return "text-yellow-600 font-bold";
    return "text-gray-600";
  }

  // Função para formatar o ID da cartela (últimos 4 dígitos)
  const formatCardId = (cardId: string): string => {
    if (!cardId) return "????";
    return cardId.slice(-4).toUpperCase();
  };

  // 1. Verificar se uma cartela fez quadra
  const temQuadra = (card: BingoCard): boolean => {
    for (let row = 0; row < 5; row++) {
      let markedInRow = 0;
      for (let col = 0; col < 5; col++) {
        const index = row * 5 + col;
        const number = card.numbers[index];
        const isFree = col === 2 && row === 2;
        if (isFree || drawnNumbers.includes(number)) {
          markedInRow++;
        }
      }
      if (markedInRow === 4) return true;
    }
    return false;
  };

  // 2. Verificar se uma cartela fez quina
  const temQuina = (card: BingoCard): boolean => {
    for (let row = 0; row < 5; row++) {
      let markedInRow = 0;
      for (let col = 0; col < 5; col++) {
        const index = row * 5 + col;
        const number = card.numbers[index];
        const isFree = col === 2 && row === 2;
        if (isFree || drawnNumbers.includes(number)) {
          markedInRow++;
        }
      }
      if (markedInRow === 5) return true;
    }
    return false;
  };

  // 3. Verificar se uma cartela está cheia
  const temCheia = (card: BingoCard): boolean => {
    let totalMarked = 0;
    card.numbers.forEach((number, index) => {
      const row = Math.floor(index / 5);
      const col = index % 5;
      const isFree = col === 2 && row === 2;
      if (isFree || drawnNumbers.includes(number)) {
        totalMarked++;
      }
    });
    return totalMarked === 25;
  };

  // Função de depuração para ajudar a diagnosticar problemas
  const logDebugInfo = () => {
    if (!draw || !draw.winners) return;
    
    const winners = draw.winners as Record<string, string[]>;
    console.group("=== DEBUG: Estado do Sorteio ===");
    console.log(`Fase atual: ${draw.currentPhase}`);
    console.log(`Números sorteados: ${drawnNumbers.length}/90`);
    console.log(`Ganhadores quadra: ${(winners.quadra || []).length}`, winners.quadra || []);
    console.log(`Ganhadores quina: ${(winners.quina || []).length}`, winners.quina || []);
    console.log(`Ganhadores cheia: ${(winners.cheia || []).length}`, winners.cheia || []);
    
    // Verificar estado das cartelas do usuário
    const cartelasInfo = userCards.map(card => {
      const hasQuadra = temQuadra(card);
      const hasQuina = temQuina(card);
      const hasCheia = temCheia(card);
      const marked = getMarkedCount(card);
      return {
        id: formatCardId(card.id),
        marked: `${marked}/25`,
        quadra: hasQuadra ? "SIM" : "NÃO",
        quina: hasQuina ? "SIM" : "NÃO",
        cheia: hasCheia ? "SIM" : "NÃO",
        status: getCardStatus(card)
      };
    });
    
    console.table(cartelasInfo);
    console.groupEnd();
  };

  const renderBingoCard = (card: BingoCard, index: number) => {
    return (
      <Card key={card.id} className="w-full max-w-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-center text-lg">
            Cartela <span className="font-mono">{formatCardId(card.id)}</span>
          </CardTitle>
          <div className={`text-center text-sm ${getCardStatusColor(card)}`}>{getCardStatus(card)}</div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-1 mb-2">
            <div className="text-center font-bold text-sm py-1">B</div>
            <div className="text-center font-bold text-sm py-1">I</div>
            <div className="text-center font-bold text-sm py-1">N</div>
            <div className="text-center font-bold text-sm py-1">G</div>
            <div className="text-center font-bold text-sm py-1">O</div>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {card.numbers.map((number, idx) => {
              const row = Math.floor(idx / 5)
              const col = idx % 5
              const isFree = col === 2 && row === 2
              const isMarked = isFree || isNumberMarked(number)
              const isLastDrawn = number === lastDrawnNumber

              return (
                <div
                  key={`${card.id}-${idx}`}
                  className={`
                    aspect-square flex items-center justify-center text-sm font-medium border rounded transition-all duration-300
                    ${
                      isFree
                        ? "bg-yellow-200 text-yellow-800 border-yellow-300"
                        : isLastDrawn && isMarked
                          ? "bg-red-500 text-white border-red-600 shadow-md transform scale-105"
                          : isMarked
                            ? "bg-blue-500 text-white border-blue-600 shadow-md"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }
                  `}
                >
                  {isFree ? "★" : number}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    )
  }

  const renderNumbersHistory = () => {
    const lastFiveNumbers = drawnNumbers.slice(-5).reverse()

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Últimos Números Sorteados
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center gap-3">
            {lastFiveNumbers.map((number, index) => (
              <div
                key={`history-${number}-${index}`}
                className={`
                  w-12 h-12 rounded-full flex items-center justify-center font-bold text-white shadow-lg
                  ${
                    index === 0
                      ? "bg-red-500 ring-4 ring-red-200 animate-pulse"
                      : index === 1
                        ? "bg-blue-500"
                        : index === 2
                          ? "bg-green-500"
                          : index === 3
                            ? "bg-purple-500"
                            : "bg-gray-500"
                  }
                `}
              >
                {number}
              </div>
            ))}
            {lastFiveNumbers.length === 0 && (
              <p className="text-muted-foreground text-sm py-4">Nenhum número sorteado ainda</p>
            )}
          </div>
          {lastFiveNumbers.length > 0 && (
            <div className="text-center mt-3">
              <p className="text-xs text-muted-foreground">
                Último número: <span className="font-bold text-red-600">{lastFiveNumbers[0]}</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  {/*
  useEffect(() => {
    if (!user || !draw || userCards.length === 0 || drawnNumbers.length === 0) return;

    // NOVA ABORDAGEM: Separar claramente as funções de verificação
    
    // FUNÇÃO PRINCIPAL DE VERIFICAÇÃO DE GANHADORES
    const verificarGanhadores = async () => {
      if (!user || !draw || !userCards.length) return;
      
      // Executar função de depuração para ajudar a diagnosticar problemas
      logDebugInfo();
      
      try {
        // Usar transação do Firestore para garantir consistência
        await runTransaction(db, async (transaction) => {
          // 1. Obter dados atualizados do sorteio dentro da transação
          const drawRef = doc(db, "draws", drawId);
          const drawDoc = await transaction.get(drawRef);
          
          if (!drawDoc.exists()) {
            console.log("Sorteio não encontrado");
            return;
          }
          
          const drawData = drawDoc.data();
          const fase = drawData.currentPhase as "quadra" | "quina" | "cheia";
          const winners = { ...(drawData.winners || {}) };
          
          // 2. Se já existe um ganhador para a fase atual, não faz nada
          if (winners[fase] && winners[fase].length > 0) {
            console.log(`Já existe ganhador para ${fase}. Ignorando.`);
            return;
          }
          
          // 3. Filtrar cartelas elegíveis com base na fase atual
          const cartelasElegiveis = userCards.filter(card => {
            // Na fase quadra, todas as cartelas são elegíveis
            if (fase === "quadra") return true;
            
            // Na fase quina, cartelas que ganharam quadra NÃO são elegíveis
            if (fase === "quina") {
              return !(winners.quadra || []).includes(card.id);
            }
            
            // Na fase cheia, cartelas que ganharam quadra ou quina NÃO são elegíveis
            if (fase === "cheia") {
              return !(winners.quadra || []).includes(card.id) && 
                     !(winners.quina || []).includes(card.id);
            }
            
            return false;
          });
          
          console.log(`Fase atual: ${fase}, Cartelas elegíveis: ${cartelasElegiveis.length}`);
          
          // 4. Verificar se alguma cartela elegível ganhou o prêmio da fase atual
          let cartela_vencedora: BingoCard | null = null;
          
          // IMPORTANTE: Só verifica o tipo de prêmio da fase atual
          if (fase === "quadra") {
            cartela_vencedora = cartelasElegiveis.find(card => temQuadra(card)) || null;
          } 
          else if (fase === "quina") {
            cartela_vencedora = cartelasElegiveis.find(card => temQuina(card)) || null;
          }
          else if (fase === "cheia") {
            cartela_vencedora = cartelasElegiveis.find(card => temCheia(card)) || null;
          }
          
          // 5. Se encontrou um ganhador, registrar e avançar fase
          if (cartela_vencedora) {
            // Preparar objeto de winners (preservando winners anteriores)
            const updatedWinners = { ...winners };
            
            // Adicionar o ganhador atual
            if (!updatedWinners[fase]) {
              updatedWinners[fase] = [];
            }
            
            // Garantir que não há duplicatas
            if (!updatedWinners[fase].includes(cartela_vencedora.id)) {
              updatedWinners[fase] = [cartela_vencedora.id];
              
              // Determinar próxima fase
              let proximaFase = fase;
              if (fase === "quadra") proximaFase = "quina";
              else if (fase === "quina") proximaFase = "cheia";
              else proximaFase = "cheia"; // Mantém em "cheia" se já estiver nela
              
              // Atualizar no Firestore dentro da transação
              transaction.update(drawRef, {
                winners: updatedWinners,
                currentPhase: proximaFase
              });
              
              console.log(`Registrado ganhador para ${fase}: Cartela ${cartela_vencedora.id.slice(-4).toUpperCase()}`);
              console.log(`Fase avançada para: ${proximaFase}`);
            }
          }
        });
      } catch (error) {
        console.error("Erro ao verificar ganhadores:", error);
      }
    };
    
    // Executar verificação
    verificarGanhadores();
  }, [user, draw, userCards, drawnNumbers, drawId]);
  */}
  if (loading || loadingDraw) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>
  }

  if (!user || !draw) {
    return null
  }

  const formatDateTime = (date: Date) => {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-100 text-green-800">Ativo</Badge>
      case "finished":
        return <Badge variant="secondary">Finalizado</Badge>
      default:
        return <Badge variant="outline">Aguardando</Badge>
    }
  }

  return (
    <UserLayout>
      {/* Engine de Sorteio Automático */}
      <AutomaticDrawEngine drawId={drawId} isActive={draw.status === "active"} />

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => router.push("/home")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{draw.name}</h1>
              <p className="text-muted-foreground">Sala do Sorteio</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Botão de depuração para administradores */}
            {user.role === "admin" && process.env.NODE_ENV !== "production" && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => {
                  toast({
                    title: "Verificação manual iniciada",
                    description: "Verificando ganhadores..."
                  });
                  // Executar verificação manual
                  if (!user || !draw || !userCards.length) return;
                  logDebugInfo();
                  runTransaction(db, async (transaction) => {
                    // Lógica de verificação similar à função verificarGanhadores
                    const drawRef = doc(db, "draws", drawId);
                    const drawDoc = await transaction.get(drawRef);
                    
                    if (!drawDoc.exists()) {
                      console.log("Sorteio não encontrado");
                      return;
                    }
                    
                    const drawData = drawDoc.data();
                    const fase = drawData.currentPhase as "quadra" | "quina" | "cheia";
                    const winners = { ...(drawData.winners || {}) };
                    
                    // Verificar se já existe um ganhador para a fase atual
                    if (winners[fase] && winners[fase].length > 0) {
                      toast({
                        title: `Já existe ganhador para ${fase}`,
                        description: `Cartela: ${formatCardId(winners[fase][0])}`,
                      });
                      return;
                    }
                    
                    // Executar verificação
                    console.log("Executando verificação manual de ganhadores...");
                  }).catch(error => {
                    console.error("Erro na verificação manual:", error);
                    toast({
                      title: "Erro na verificação",
                      description: "Ocorreu um erro ao verificar ganhadores.",
                      variant: "destructive",
                    });
                  });
                }}
              >
                Verificar Ganhadores
              </Button>
            )}
            {getStatusBadge(draw.status)}
          </div>
        </div>

        {/* Histórico dos Últimos Números */}
        {drawnNumbers.length > 0 && renderNumbersHistory()}

        {/* Informações do Sorteio */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Informações
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Data/Hora:</span>
                <span>{formatDateTime(draw.dateTime)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Valor da Cartela:</span>
                <span>R$ {draw.cardPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Suas Cartelas:</span>
                <span>{userCards.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Modo:</span>
                <span>{draw.mode === "automatic" ? "Automático" : "Manual"}</span>
              </div>
              {draw.status === "waiting" && (
                <div className="text-center py-2 bg-yellow-50 rounded text-yellow-700 text-sm">
                  {draw.mode === "automatic" ? "Inicia automaticamente em:" : "Inicia em:"} {timeUntilStart}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5" />
                Prêmios
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {draw.type === "fixed" ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span>Quadra:</span>
                    <span>R$ {(draw.prizes as any).quadra.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Quina:</span>
                    <span>R$ {(draw.prizes as any).quina.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Cartela Cheia:</span>
                    <span>R$ {(draw.prizes as any).cheia.toFixed(2)}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between text-sm">
                    <span>Quadra:</span>
                    <span>{(draw.prizes as any).quadraPercent}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Quina:</span>
                    <span>{(draw.prizes as any).quinaPercent}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Cartela Cheia:</span>
                    <span>{(draw.prizes as any).cheiaPercent}%</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Progresso do Sorteio
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-3">
                <span className="text-3xl font-bold text-blue-600">{drawnNumbers.length}</span>
                <span className="text-lg text-muted-foreground">/90</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 mb-3">
                <div
                  className="bg-blue-600 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${(drawnNumbers.length / 90) * 100}%` }}
                />
              </div>
              <div className="text-center text-sm text-muted-foreground">
                {drawnNumbers.length === 0 ? "Aguardando início" : `${90 - drawnNumbers.length} números restantes`}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Gerador de Números - Exibido durante sorteio ativo manual */}
        {draw.status === "active" && draw.mode === "manual" && draw.externalUrl && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5" />
                Sorteio ao Vivo
              </CardTitle>
              <CardDescription>Acompanhe o sorteio dos números em tempo real</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full h-[500px] border rounded-lg overflow-hidden bg-gray-50">
                <iframe
                  src={draw.externalUrl}
                  className="w-full h-full border-0"
                  title="Sorteio de Números ao Vivo"
                  allow="fullscreen"
                  loading="lazy"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Cartelas do Usuário */}
        <div>
          <h2 className="text-xl font-semibold mb-4">
            Suas Cartelas
            {draw.status === "active" && (
              <span className="text-sm text-green-600 ml-2">(Marcação automática ativa)</span>
            )}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {userCards.map((card, index) => renderBingoCard(card, index))}
          </div>
        </div>

        {/* Todos os Números Sorteados */}
        {drawnNumbers.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Todos os Números Sorteados</CardTitle>
              <CardDescription>Histórico completo do sorteio</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {drawnNumbers.map((number, index) => (
                  <div
                    key={`all-${number}-${index}`}
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold
                      ${
                        number === lastDrawnNumber
                          ? "bg-red-500 text-white ring-2 ring-red-300"
                          : "bg-gray-600 text-white"
                      }`}
                  >
                    {number}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Modal de Ganhador */}
      <WinnerModal
        open={showWinnerModal}
        winners={winnerInfo || []}
        onOpenChange={setShowWinnerModal}
        autoClose={true}
        autoCloseTime={15}
        onTimerEnd={() => {
          setShowWinnerModal(false);
          setWinnerInfo(null);
        }}
        isAdmin={false}
      />

    </UserLayout>
  )
}
