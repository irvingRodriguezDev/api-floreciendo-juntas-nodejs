
const Subscription = require("../models/Subscription");
const User = require("../models/User");
const resend = require("../config/resend");
const generateSubscriptionReminder = require("../helpers/SubscriptionReminder");
const { Op } = require("sequelize");

async function sendSubscriptionReminders() {
    try {
        // Obtener la fecha de dentro de 5 días
        const now = new Date();

        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + 5);

        const startDate = new Date(targetDate);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(targetDate);
        endDate.setHours(23, 59, 59, 999);

        // Buscar suscripciones activas próximas a renovarse
        const subscriptions = await Subscription.findAll({
            where: {
                status: "active",
                next_renewal: {
                    [Op.between]: [startDate, endDate],
                },
            },
            include: [
                {
                    model: User,
                    attributes: ["id", "name", "email"],
                    required: true,
                },
            ],
        });

        console.log(
            `📧 Suscripciones próximas a renovarse: ${subscriptions.length}`
        );

        for (const subscription of subscriptions) {
            try {
                const user = subscription.User;

                if (!user || !user.email) continue;

                // Generar HTML del correo
                const html = generateSubscriptionReminder(user, subscription);

                // Enviar correo mediante Resend
                const { data, error } = await resend.emails.send({
                    from: process.env.RESEND_FROM,
                    to: user.email,
                    subject: "💗 Tu suscripción se renovará en 5 días",
                    html,
                });

                if (error) {
                    console.error(
                        `❌ Error enviando correo a ${user.email}:`,
                        error.message
                    );
                    continue;
                }

                console.log(
                    `✅ Recordatorio enviado a ${user.email}`,
                    data?.id
                );

            } catch (error) {
                console.error(
                    `❌ Error procesando suscripción ${subscription.id}:`,
                    error.message
                );
            }
        }

    } catch (error) {
        console.error(
            "❌ Error en sendSubscriptionReminders:",
            error
        );
    }
}

module.exports = { sendSubscriptionReminders };
