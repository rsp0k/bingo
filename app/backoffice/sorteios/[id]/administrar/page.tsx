"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter, useParams } from "next/navigation"
import { doc, getDoc, updateDoc, collection, getDocs, query, where, onSnapshot } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AdminLayout } from "@/components/layout/admin-layout"
import { useAuth } from "@/hooks/use-auth"
import { db } from "@/lib/firebase"
import type { Draw } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { WinnerModal } from "@/components/WinnerModal"
import { creditUserPrize, calculatePrize, checkCardWinner as checkCardWinnerUtil } from "@/lib/prize-utils"

interface Winner {
  userId: string;
  userName: string;
  cardId: string;
  type: "quadra" | "quina" | "cheia";
  prize: number;
}

interface Card {
  id: string;
  userId: string;
  drawId: string;
  numbers: number[];
  purchaseDate: Date;
}

export default function AdminManageDrawPage() {
  const { user, loading } = useAuth()
  const [draw, setDraw] = useState<Draw | null>(null)
  const [loadingDraw, setLoadingDraw] = useState(true)
  const [drawnNumbers, setDrawnNumbers] = useState<number[]>([])
  const [totalCards, setTotalCards] = useState(0)
  const router = useRouter()
  const params = useParams()
  const { toast } = useToast()
  const drawId = params.id as string
  const [showWinnerModal, setShowWinnerModal] = useState(false)
  const [winnerInfo, setWinnerInfo] = useState<Winner[] | null>(null)
  const lastWinnersRef = useRef({ quadra: new Set<string>(), quina: new Set<string>(), cheia: new Set<string>() })
  const winnerTypes = ["quadra", "quina", "cheia"] as const
  type WinnerType = typeof winnerTypes[number]

  useEffect(() => {
    if (!loading && (!user || user.role !== "admin")) {
      router.push("/backoffice/login")
    }
  }, [user, loading, router])

  useEffect(() => {
    const fetchDraw = async () => {
      try {
        const drawDoc = await getDoc(doc(db, "draws", drawId))
        if (drawDoc.exists()) {
          const drawData = {
            id: drawDoc.id,
            ...drawDoc.data(),
            dateTime: drawDoc.data().dateTime.toDate(),
            createdAt: drawDoc.data().createdAt.toDate(),
          } as Draw

          setDraw(drawData)
          setDrawnNumbers(drawData.drawnNumbers || [])

          // Contar cartelas vendidas
          const cardsQuery = query(collection(db, "cards"), where("drawId", "==", drawId))
          const cardsSnapshot = await getDocs(cardsQuery)
          setTotalCards(cardsSnapshot.size)
        } else {
          toast({
            title: "Sorteio não encontrado",
            description: "O sorteio solicitado não existe.",
            variant: "destructive",
          })
          router.push("/backoffice/sorteios")
        }
      } catch (error) {
        console.error("Error fetching draw:", error)
        toast({
          title: "Erro",
          description: "Não foi possível carregar o sorteio.",
          variant: "destructive",
        })
      } finally {
        setLoadingDraw(false)
      }
    }

    if (user?.role === "admin") {
      fetchDraw()
    }
  }, [user, drawId, router, toast])

  // Listener em tempo real para winners
  useEffect(() => {
    if (!user) return;

    const unsub = onSnapshot(doc(db, "draws", drawId), async (docSnapshot) => {
      if (!docSnapshot.exists()) return;
      const updatedDraw = {
        id: docSnapshot.id,
        ...docSnapshot.data(),
        dateTime: docSnapshot.data().dateTime.toDate(),
        createdAt: docSnapshot.data().createdAt.toDate(),
      } as Draw;

      setDraw(updatedDraw);
      setDrawnNumbers(updatedDraw.drawnNumbers || []);

      // --- NOVO: lógica para winners ---
      if (updatedDraw.winners) {
        winnerTypes.forEach(async (type) => {
          const current = new Set((updatedDraw.winners as Record<string, string[]>)[type] || []);
          const last = lastWinnersRef.current[type];
          const newCards = Array.from(current).filter((cardId) => !last.has(cardId));
          if (newCards.length > 0) {
            // Buscar dados dos usuários e cartelas
            const winners = await Promise.all(
              newCards.map(async (cardId: string) => {
                const cardDoc = await getDoc(doc(db, "cards", cardId));
                const cardData = cardDoc.data();
                let userName = "Usuário";
                let userId = "";
                if (cardData) {
                  userId = cardData.userId;
                  const userDoc = await getDoc(doc(db, "users", userId));
                  userName = userDoc.data()?.name || "Usuário";
                }
                return {
                  userId,
                  userName,
                  cardId,
                  type,
                  prize: updatedDraw.type === "fixed"
                    ? (updatedDraw.prizes as any)[type]
                    : 100
                };
              })
            );
            setWinnerInfo(winners);
            setShowWinnerModal(true);
          }
          lastWinnersRef.current[type] = new Set(current);
        });
      }
    });
    return () => unsub();
  }, [user, drawId]);

  const handleDrawNumber = async (number: number) => {
    if (drawnNumbers.includes(number)) {
      toast({
        title: "Número já sorteado",
        description: `O número ${number} já foi sorteado.`,
        variant: "destructive",
      })
      return
    }

    try {
      const newDrawnNumbers = [...drawnNumbers, number]
      await updateDoc(doc(db, "draws", drawId), {
        drawnNumbers: newDrawnNumbers,
      })

      setDrawnNumbers(newDrawnNumbers)

      toast({
        title: "Número sorteado",
        description: `O número ${number} foi sorteado com sucesso.`,
      })

      await checkManualWinners(newDrawnNumbers)
    } catch (error) {
      console.error("Error drawing number:", error)
      toast({
        title: "Erro",
        description: "Não foi possível sortear o número.",
        variant: "destructive",
      })
    }
  }

  const handleStartDraw = async () => {
    if (!draw) return

    try {
      await updateDoc(doc(db, "draws", drawId), {
        status: "active",
      })

      setDraw({
        ...draw,
        status: "active",
      })

      toast({
        title: "Sorteio iniciado",
        description: "O sorteio foi iniciado com sucesso.",
      })
    } catch (error) {
      console.error("Error starting draw:", error)
      toast({
        title: "Erro",
        description: "Não foi possível iniciar o sorteio.",
        variant: "destructive",
      })
    }
  }

  const handleFinishDraw = async () => {
    if (!draw) return

    if (confirm("Tem certeza que deseja finalizar este sorteio? Esta ação não pode ser desfeita.")) {
      try {
        await updateDoc(doc(db, "draws", drawId), {
          status: "finished",
        })

        setDraw({
          ...draw,
          status: "finished",
        })

        toast({
          title: "Sorteio finalizado",
          description: "O sorteio foi finalizado com sucesso.",
        })
      } catch (error) {
        console.error("Error finishing draw:", error)
        toast({
          title: "Erro",
          description: "Não foi possível finalizar o sorteio.",
          variant: "destructive",
        })
      }
    }
  }

  const checkManualWinners = async (currentDrawnNumbers: number[]) => {
    // Buscar todas as cartelas do sorteio
    const cardsQuery = query(collection(db, "cards"), where("drawId", "==", drawId));
    const cardsSnapshot = await getDocs(cardsQuery);

    // Buscar o sorteio atual para pegar ou inicializar winners
    const drawDoc = await getDoc(doc(db, "draws", drawId));
    const drawData = drawDoc.data();
    const updatedWinners = { ...(drawData?.winners || {}) } as Record<Winner["type"], string[]>;
    const previousWinners = { ...updatedWinners };

    for (const cardDoc of cardsSnapshot.docs) {
      const card = { id: cardDoc.id, ...cardDoc.data() } as Card;

      // Função para checar tipo de vitória (quadra, quina, cheia)
      const winnerType = checkCardWinnerUtil(card, currentDrawnNumbers);

      if (winnerType) {
        // Remover a cartela de todas as listas menores
        if (winnerType === "cheia") {
          updatedWinners["quadra"] = (updatedWinners["quadra"] || []).filter((id) => id !== card.id);
          updatedWinners["quina"] = (updatedWinners["quina"] || []).filter((id) => id !== card.id);
        } else if (winnerType === "quina") {
          updatedWinners["quadra"] = (updatedWinners["quadra"] || []).filter((id) => id !== card.id);
          // Se já estava em cheia, não adiciona em quina
          if ((updatedWinners["cheia"] || []).includes(card.id)) continue;
        } else if (winnerType === "quadra") {
          // Se já estava em quina ou cheia, não adiciona em quadra
          if ((updatedWinners["quina"] || []).includes(card.id)) continue;
          if ((updatedWinners["cheia"] || []).includes(card.id)) continue;
        }
        if (!updatedWinners[winnerType]) {
          updatedWinners[winnerType] = [];
        }
        // Adiciona apenas se não estiver já na lista
        if (!updatedWinners[winnerType].includes(card.id)) {
          updatedWinners[winnerType].push(card.id);
        }
      }
    }

    // Atualiza winners no Firestore
    await updateDoc(doc(db, "draws", drawId), {
      winners: updatedWinners,
    });

    // === CREDITAR SALDO DOS NOVOS VENCEDORES ===
    await creditWinners(previousWinners, updatedWinners, drawData);
  };

  const creditWinners = async (
    previousWinners: Record<Winner["type"], string[]>, 
    updatedWinners: Record<Winner["type"], string[]>, 
    drawData: any
  ) => {
    const winnerTypes: Winner["type"][] = ["quadra", "quina", "cheia"];
    
    for (const type of winnerTypes) {
      const previousCards = new Set(previousWinners[type] || []);
      const currentCards = new Set(updatedWinners[type] || []);
      
      // Encontrar novos vencedores
      const newWinners = Array.from(currentCards).filter(cardId => !previousCards.has(cardId));
      
      for (const cardId of newWinners) {
        try {
          // Buscar dados da cartela
          const cardDoc = await getDoc(doc(db, "cards", cardId));
          if (!cardDoc.exists()) continue;
          
          const cardData = cardDoc.data();
          const userId = cardData.userId;
          
          // Buscar dados do usuário
          const userDoc = await getDoc(doc(db, "users", userId));
          if (!userDoc.exists()) continue;
          
          const userData = userDoc.data();
          const userName = userData.name || "Usuário";
          
          // Calcular prêmio
          const prize = calculatePrize(type, drawData);
          
          if (prize > 0) {
            const success = await creditUserPrize(userId, prize, type, cardId);
            
            if (success) {
              toast({
                title: "🎉 Prêmio Creditado!",
                description: `${userName} ganhou R$ ${prize.toFixed(2)} na ${type}!`,
              });
            }
          }
        } catch (error) {
          console.error(`Erro ao creditar prêmio para cartela ${cardId}:`, error);
        }
      }
    }
  };



  if (loading || loadingDraw) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>
  }

  if (!user || user.role !== "admin" || !draw) {
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

  const renderNumberGrid = () => {
    const numbers = Array.from({ length: 90 }, (_, i) => i + 1)
    return (
      <div className="grid grid-cols-10 gap-2">
        {numbers.map((number) => (
          <Button
            key={number}
            variant={drawnNumbers.includes(number) ? "default" : "outline"}
            size="sm"
            className={`h-10 w-10 p-0 ${drawnNumbers.includes(number) ? "bg-blue-600 text-white" : "hover:bg-blue-50"}`}
            onClick={() => handleDrawNumber(number)}
            disabled={draw.status !== "active" || drawnNumbers.includes(number)}
          >
            {number}
          </Button>
        ))}
      </div>
    )
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Administrar Sorteio</h1>
            <p className="text-muted-foreground">{draw.name}</p>
          </div>
          <div className="flex items-center gap-2">
            {draw.status === "waiting" && <Button onClick={handleStartDraw}>Iniciar Sorteio</Button>}
            {draw.status === "active" && (
              <Button variant="destructive" onClick={handleFinishDraw}>
                Finalizar Sorteio
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Informações do Sorteio</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between">
                <span>Status:</span>
                {getStatusBadge(draw.status)}
              </div>
              <div className="flex justify-between">
                <span>Data/Hora:</span>
                <span>{formatDateTime(draw.dateTime)}</span>
              </div>
              <div className="flex justify-between">
                <span>Valor da Cartela:</span>
                <span>R$ {draw.cardPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Modo:</span>
                <span>{draw.mode === "automatic" ? "Automático" : "Manual"}</span>
              </div>
              <div className="flex justify-between">
                <span>Cartelas Vendidas:</span>
                <span>{totalCards}</span>
              </div>
              <div className="flex justify-between">
                <span>Números Sorteados:</span>
                <span>{drawnNumbers.length}/90</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Últimos Números</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {drawnNumbers.slice(-10).map((number) => (
                  <div
                    key={number}
                    className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold"
                  >
                    {number}
                  </div>
                ))}
                {drawnNumbers.length === 0 && (
                  <p className="text-muted-foreground text-sm">Nenhum número sorteado ainda</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Prêmios</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {draw.type === "fixed" ? (
                <>
                  <div className="flex justify-between">
                    <span>Quadra:</span>
                    <span>R$ {(draw.prizes as any).quadra.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Quina:</span>
                    <span>R$ {(draw.prizes as any).quina.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cartela Cheia:</span>
                    <span>R$ {(draw.prizes as any).cheia.toFixed(2)}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span>Quadra:</span>
                    <span>{(draw.prizes as any).quadraPercent}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Quina:</span>
                    <span>{(draw.prizes as any).quinaPercent}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cartela Cheia:</span>
                    <span>{(draw.prizes as any).cheiaPercent}%</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Iframe para sorteios manuais */}
        {draw.mode === "manual" && draw.externalUrl && (
          <Card>
            <CardHeader>
              <CardTitle>Gerador de Números</CardTitle>
              <CardDescription>Sistema de geração de números para bingo manual</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full h-[600px] border rounded-lg overflow-hidden">
                <iframe
                  src={draw.externalUrl}
                  className="w-full h-full border-0"
                  title="Gerador de Números para Bingo"
                  allow="fullscreen"
                  loading="lazy"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Painel de números apenas para sorteios manuais */}
        {draw.mode === "manual" && (
          <Card>
            <CardHeader>
              <CardTitle>Painel de Números</CardTitle>
              <CardDescription>Clique nos números para sorteá-los. Números em azul já foram sorteados.</CardDescription>
            </CardHeader>
            <CardContent>{renderNumberGrid()}</CardContent>
          </Card>
        )}

        {/* Aviso para sorteios automáticos */}
        {draw.mode === "automatic" && (
          <Card>
            <CardHeader>
              <CardTitle>Sorteio Automático</CardTitle>
              <CardDescription>
                Este sorteio é automático. Os números são sorteados automaticamente pelo sistema.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  O sistema sorteia automaticamente um número a cada 3 segundos quando o sorteio está ativo.
                </p>
                {draw.status === "active" && (
                  <p className="text-green-600 font-medium mt-2">✅ Sorteio automático em andamento</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

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
          isAdmin={true}
        />
      </div>
    </AdminLayout>
  )
}
