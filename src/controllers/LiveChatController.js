// controllers/liveChatController.js
const awsIvs = require("@aws-sdk/client-ivschat");

// Mapeo seguro por si el paquete exporta por default o nombrado

const IvsChatClient = awsIvs.IvschatClient || awsIvs.default?.IvschatClient;
const CreateChatTokenCommand =
  awsIvs.CreateChatTokenCommand || awsIvs.default?.CreateChatTokenCommand;

// Inicializamos el cliente con la región de tu IVS
const ivsChatClient = new IvsChatClient({
  region: process.env.AWS_IVS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_IVS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_IVS_SECRET_KEY,
  },
});
const getLiveChatToken = async (req, res) => {
  try {
    const user = req.user; // Usuario autenticado desde el middleware de JWT

    const { roomArn } = req.body;

    const targetRoomArn = roomArn || process.env.AWS_IVS_CHAT_ROOM_ARN;

    if (!targetRoomArn) {
      return res.status(400).json({ error: "El ARN de la sala es requerido" });
    }

    // Definir capacidades según el rol del usuario (1 = Admin, 2 = Instructor)
    const capabilities =
      user.roleId === 1 || user.roleId === 4
        ? ["SEND_MESSAGE", "DELETE_MESSAGE", "DISCONNECT_USER"]
        : ["SEND_MESSAGE"];

    const command = new CreateChatTokenCommand({
      roomIdentifier: targetRoomArn,
      userId: String(user.id),
      attributes: {
        username: String(user.name || "Alumna"),
        avatar: String(user.avatarUrl || ""),
        roleId: String(user.roleId),
      },
      capabilities,
      sessionDurationInMinutes: 180, // Duración del token (3 horas)
    });

    const response = await ivsChatClient.send(command);

    return res.status(200).json({
      success: true,
      token: response.token,
      sessionExpirationTime: response.sessionExpirationTime,
      tokenExpirationTime: response.tokenExpirationTime,
    });
  } catch (error) {
    console.error("❌ Error al generar token de IVS Chat:", error);
    return res
      .status(500)
      .json({ error: "Error al conectarse al chat del live" });
  }
};

module.exports = {
  getLiveChatToken,
};
