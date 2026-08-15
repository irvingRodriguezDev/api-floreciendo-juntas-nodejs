const { Op } = require("sequelize");
const dayjs = require("dayjs");
const {
  Conversation,
  Message,
  User,
  Notifications,
  NotificationToken,
} = require("../models");
// Reemplaza por la ruta de tu servicio de Firebase FCM si ya lo tienes configurado
const {
  sendPushNotification,
  sendPushNotificationMulticast,
} = require("../services/sendPushNotification");
const emitNotification = require("../helpers/emitNotification");

const sendBirthdayWish = async (req, res) => {
  try {
    const senderId = req.user.id;
    const userSender = req.user.nombre || req.user.name || "Una usuaria";
    // 🔑 Recibimos opcionalmente el 'type' del body para saber si es de cumple o un chat normal
    const { receiverId, messageText, type = "DIRECT_MESSAGE" } = req.body;

    if (!receiverId || !messageText) {
      return res.status(400).json({
        message: "El destinatario y el mensaje son obligatorios.",
      });
    }

    if (parseInt(senderId) === parseInt(receiverId)) {
      return res.status(400).json({
        message: "No puedes enviarte un mensaje a ti misma.",
      });
    }

    // A. Buscar o crear la conversación
    let conversation = await Conversation.findOne({
      where: {
        [Op.or]: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      },
    });

    if (!conversation) {
      conversation = await Conversation.create({
        senderId,
        receiverId,
        lastMessage: messageText,
        lastMessageAt: new Date(),
      });
    } else {
      await conversation.update({
        lastMessage: messageText,
        lastMessageAt: new Date(),
      });
    }

    // B. Crear el mensaje con su tipo correspondiente
    const messageType = type === "BIRTHDAY_WISH" ? "BIRTHDAY_WISH" : "TEXT";

    const newMessage = await Message.create({
      conversationId: conversation.id,
      senderId,
      receiverId,
      body: messageText,
      type: messageType,
      read: false,
    });

    // C. Notificación Push y WebSockets en segundo plano (Async IIFE)
    (async () => {
      try {
        // 🔑 1. Títulos y textos dinámicos según el origen
        const isBirthday = type === "BIRTHDAY_WISH";

        const notifTitle = isBirthday
          ? "🥳 ¡Te han felicitado por tu cumpleaños! 🥳"
          : type === "REPLY_STORY"
            ? ` ${userSender} respondio tu historia`
            : type === "REACTION_STORY"
              ? `${userSender} Reacciono a tu historia`
              : `💬 Nuevo mensaje de ${userSender}`;

        const notifBody = isBirthday
          ? `${userSender} te envió una felicitación de cumpleaños.`
          : messageText.length > 60
            ? `${messageText.substring(0, 60)}...`
            : messageText;

        // 🔑 2. Crear notificación interna asignada al RECEPTOR (receiverId)
        const notification = await Notifications.create({
          userId: receiverId, // 👈 Se le guarda en la bandeja a quien recibe
          actorId: senderId, // 👈 Quien realizó la acción
          type: isBirthday ? "birthday_wish" : "direct_message",
          title: notifTitle,
          body: notifBody,
          data: { senderId, conversationId: conversation.id },
        });

        // 🔑 3. Emitir WebSocket en tiempo real al RECEPTOR
        if (typeof emitNotification === "function") {
          emitNotification(receiverId, notification); // 👈 Asignado a receiverId
        }

        // 🔑 4. Buscar tokens de FCM del DESTINATARIO (receiverId)
        const tokenRows = await NotificationToken.findAll({
          where: {
            userId: receiverId, // 👈 Corregido: Buscamos tokens de la receptora
            isActive: true,
          },
          attributes: ["token"],
        });

        if (tokenRows.length > 0) {
          const tokens = tokenRows.map((t) => t.token);

          // 🔑 5. Enviar Push Nativo vía FCM Multicast
          await sendPushNotificationMulticast({
            tokens,
            title: notifTitle,
            body: notifBody,
            data: {
              type: isBirthday ? "birthday_wish" : "direct_message",
              conversationId: String(conversation.id),
              senderId: String(senderId),
            },
          }).catch((pushErr) =>
            console.error("❌ Error en Push FCM de mensajería:", pushErr)
          );
        }
      } catch (err) {
        console.error("❌ Error enviando notificación de mensaje:", err);
      }
    })();

    return res.status(201).json({
      message: "Mensaje enviado con éxito.",
      data: newMessage,
      conversationId: conversation.id,
    });
  } catch (error) {
    console.error("Error al enviar el mensaje:", error);
    return res.status(500).json({
      message: "Ocurrió un error al enviar el mensaje.",
      error: error.message,
    });
  }
};

/**
 * 2. OBTENER BANDEJA DE ENTRADA (LISTA DE CONVERSACIONES)
 * Endpoint: GET /api/messages/conversations
 */
const getConversations = async (req, res) => {
  try {
    const userId = req.user.id;

    const conversations = await Conversation.findAll({
      where: {
        [Op.or]: [{ senderId: userId }, { receiverId: userId }],
      },
      include: [
        {
          model: User,
          as: "sender",
          attributes: ["id", "name", "profileImage"],
        },
        {
          model: User,
          as: "receiver",
          attributes: ["id", "name", "profileImage"],
        },
      ],
      order: [["lastMessageAt", "DESC"]],
    });

    // Formatear la conversación para que el "otro usuario" siempre sea fácil de identificar
    const formattedConversations = conversations.map((conv) => {
      const otherUser = conv.senderId === userId ? conv.receiver : conv.sender;

      return {
        id: conv.id,
        lastMessage: conv.lastMessage,
        lastMessageAt: conv.lastMessageAt,
        otherUser,
      };
    });

    return res.status(200).json({ conversations: formattedConversations });
  } catch (error) {
    console.error("Error al obtener conversaciones:", error);
    return res.status(500).json({
      message: "Error al obtener la bandeja de entrada.",
      error: error.message,
    });
  }
};

/**
 * 3. OBTENER MENSAJES DE UNA CONVERSACIÓN ESPECÍFICA
 * Endpoint: GET /api/messages/conversations/:conversationId
 */
const getMessagesByConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    // Verificar que la conversación pertenece a la usuaria
    const conversation = await Conversation.findOne({
      where: {
        id: conversationId,
        [Op.or]: [{ senderId: userId }, { receiverId: userId }],
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversación no encontrada o no tienes acceso.",
      });
    }

    // Obtener los mensajes
    const messages = await Message.findAll({
      where: { conversationId },
      include: [
        {
          model: User,
          as: "sender",
          attributes: ["id", "name", "profileImage"],
        },
      ],
      order: [["createdAt", "ASC"]],
    });

    return res.status(200).json({ messages });
  } catch (error) {
    console.error("Error al obtener mensajes:", error);
    return res.status(500).json({
      message: "Error al obtener los mensajes.",
      error: error.message,
    });
  }
};

/**
 * 4. MARCAR MENSAJES COMO LEÍDOS
 * Endpoint: PUT /api/messages/read/:conversationId
 */
const markAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    // Marcar como leídos solo los mensajes dirigidos a la usuaria actual
    await Message.update(
      { read: true },
      {
        where: {
          conversationId,
          receiverId: userId,
          read: false,
        },
      }
    );

    return res.status(200).json({ message: "Mensajes marcados como leídos." });
  } catch (error) {
    console.error("Error al marcar como leídos:", error);
    return res.status(500).json({
      message: "Error al actualizar estado de lectura.",
      error: error.message,
    });
  }
};

/**
 * 5. CONTADOR DE MENSAJES NO LEÍDOS (Para el Badge del Menú)
 * Endpoint: GET /api/messages/unread-count
 */
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const unreadCount = await Message.count({
      where: {
        receiverId: userId,
        read: false,
      },
    });

    return res.status(200).json({ unreadCount });
  } catch (error) {
    console.error("Error al obtener contador de no leídos:", error);
    return res.status(500).json({
      message: "Error al obtener conteo de no leídos.",
      error: error.message,
    });
  }
};

module.exports = {
  sendBirthdayWish,
  getConversations,
  getMessagesByConversation,
  markAsRead,
  getUnreadCount,
};
