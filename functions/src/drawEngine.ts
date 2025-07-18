import { db } from "./firebase"

export async function verificarGanhador(drawId: string) {
  const drawRef = db.collection("draws").doc(drawId)

  await db.runTransaction(async (transaction) => {
    const drawDoc = await transaction.get(drawRef)
    if (!drawDoc.exists) return
    const drawData = drawDoc.data()
    if (!drawData) return

    const fase = drawData.currentPhase as "quadra" | "quina" | "cheia"
    const winners = { ...(drawData.winners || {}) }
    const drawnNumbers: number[] = drawData.drawnNumbers || []

    // Se já teve ganhador nessa fase, encerra
    if (winners[fase]?.length > 0) return

    const snapshot = await db.collection("cards").where("drawId", "==", drawId).get()
    const allCards = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

    const elegiveis = allCards.filter((card: any) => {
      if (fase === "quadra") return true
      if (fase === "quina") return !(winners.quadra || []).includes(card.id)
      if (fase === "cheia") return !((winners.quadra || []).includes(card.id) || (winners.quina || []).includes(card.id))
      return false
    })

    const checkCard = (card: any, tipo: "quadra" | "quina" | "cheia") => {
      const isFree = (i: number) => i === 12 // casa do meio
      if (tipo === "cheia") {
        return card.numbers.every((n: number, i: number) => isFree(i) || drawnNumbers.includes(n))
      }

      return [...Array(5).keys()].some((row) => {
        const linha = [...Array(5).keys()].map((col) => {
          const idx = row * 5 + col
          const n = card.numbers[idx]
          return isFree(idx) || drawnNumbers.includes(n)
        })
        const marcados = linha.filter(Boolean).length
        return (tipo === "quadra" && marcados === 4) || (tipo === "quina" && marcados === 5)
      })
    }

    const ganhador = elegiveis.find((card: any) => checkCard(card, fase))
    if (!ganhador) return

    // Atualiza winners
    if (!winners[fase]) winners[fase] = []
    winners[fase].push(ganhador.id)

    const nextPhase = fase === "quadra" ? "quina" : fase === "quina" ? "cheia" : null

    const updateData: any = {
      winners,
      currentPhase: nextPhase || fase,
    }

    if (fase === "cheia") {
      updateData.status = "finished"
    }

    // === Atualizar saldo do ganhador ===
    const cardDoc = await transaction.get(db.collection("cards").doc(ganhador.id))
    const cardData = cardDoc.data()
    if (!cardData) return

    const userRef = db.collection("users").doc(cardData.userId)
    const userDoc = await transaction.get(userRef)
    const userData = userDoc.data()
    if (!userDoc.exists || !userData) return

    const prize = drawData?.type === "fixed"
      ? drawData.prizes?.[fase] || 0
      : 0

    transaction.update(userRef, {
      balance: (userData.balance || 0) + prize,
    })

    // === Atualiza sorteio ===
    transaction.update(drawRef, updateData)
  })
}
