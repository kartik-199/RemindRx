import admin = require("firebase-admin");
import { getFirestore, Filter } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { onSchedule } from "firebase-functions/v2/scheduler";

admin.initializeApp({
    credential: admin.credential.applicationDefault(),
});

exports.sendNotifications = onSchedule("*/5 * * * *", async () => {
    const weekday = new Date().getUTCDay();
    const monthDay = Number(new Date().toISOString().slice(8, 10));
    const time = new Date().toISOString().slice(11, 16);
    const users = await getFirestore().collection("Users").get();
    console.log (`weekday: ${weekday}, day of month: ${monthDay} time: ${time}`);
    for (const user of users.docs) {
        const message = {
            notification: {
                "title":"Time for your medications!",
                "body":""
            },
            tokens: user.data()["FCMTokens"],
            webpush: {
                fcmOptions: {
                    link: '/home'
                }
            },
        };
        const meds = await getFirestore().collection("Users").doc(user.id).collection("Medications")
            .where("isTaken", "==", false)
            .where("timeUTC", "==", time)
            .where(Filter.or(
                Filter.where("freq", "==", "daily"),
                Filter.and(
                    Filter.where("freq", "==", "weekly"),
                    Filter.where("dayUTC", "==", weekday)
                ),
                Filter.and(
                    Filter.where("freq", "==", "monthly"),
                    Filter.where("dayUTC", "==", monthDay)
                )
            )).get();
        meds.forEach(med => {
            const data = med.data();
            message.notification.body += `Time to take ${data["name"]} - ${data["dosage"]}\n`;
        });
        if (message.notification.body !== "" && message.tokens.length > 0)
            getMessaging().sendEachForMulticast(message)
                .then(response => {
                    console.log(response.successCount + ' messages were sent successfully');
                });
    }
});

exports.unMarkMeds = onSchedule("0 */2 * * *", async () => {
    const weekday = new Date().getUTCDay();
    const monthDay = Number(new Date().toISOString().slice(8, 10));
    const time = new Date().toISOString().slice(11, 16);
    const timeP8 = ((Number(time.slice(0, 2)) + 8) % 24).toString().padStart(2, '0') + time.slice(2, 5);

    console.log (`weekday: ${weekday}, day of month: ${monthDay}, time: ${time}, time+8: ${timeP8}`);

    const users = await getFirestore().collection("Users").get();
    const batch = getFirestore().batch();
    for (const user of users.docs) {
        const meds = await getFirestore().collection("Users").doc(user.id).collection("Medications")
            .where("isTaken", "==", true)
            .where(Filter.or(
                Filter.and(
                    Filter.where("freq", "==", "daily"),
                    Filter.where("timeUTC", "<=", timeP8)
                ),
                Filter.and(
                    Filter.where("freq", "==", "weekly"),
                    Filter.where("dayUTC", "==", (weekday+1)%7),
                ),
                Filter.and(
                    Filter.where("freq", "==", "monthly"),
                    Filter.where("dayUTC", "==", (monthDay+3)%31)
                )
            )).get();
        for (const med of meds.docs) {
            batch.update(
                getFirestore().collection("Users").doc(user.id).collection("Medications").doc(med.id),
                {isTaken: false}
            );
        }
    }
    await batch.commit();
})