import * as functions from "firebase-functions/v1"
import { db } from "./firebase"
import { verificarGanhador } from "./drawEngine"

export const scheduledCheckWinners = functions.pubsub.schedule("every 1 minutes").onRun(async () => {
  const snapshot = await db.collection("draws").where("status", "==", "active").get()

  for (const doc of snapshot.docs) {
    await verificarGanhador(doc.id)
  }
})

export const scheduledStartDraws = functions.pubsub.schedule("every 1 minutes").onRun(async () => {
  const now = new Date()
  const snapshot = await db.collection("draws").where("status", "==", "waiting").get()

  for (const doc of snapshot.docs) {
    const data = doc.data()
    const startTime = data.dateTime.toDate?.() || data.dateTime
    if (startTime <= now) {
      await db.collection("draws").doc(doc.id).update({ status: "active" })
    }
  }
})
