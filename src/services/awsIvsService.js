// services/awsIvsService.js
const {
  IvsClient,
  CreateChannelCommand,
  DeleteChannelCommand,
  GetChannelCommand,
  GetStreamCommand,
  CreateStreamKeyCommand,
} = require("@aws-sdk/client-ivs");

const ivsClient = new IvsClient({
  region: process.env.AWS_IVS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_IVS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_IVS_SECRET_KEY,
  },
});

// ========================
// OPCIÓN A: Configuración estática (un solo canal para todos)
// ========================
const getIvsChannelConfig = () => {
  return {
    channelArn: process.env.AWS_IVS_CHANNEL_ARN,
    playbackUrl: process.env.AWS_IVS_PLAYBACK_URL,
    streamKey: process.env.AWS_IVS_STREAM_KEY,
    ingestEndpoint: process.env.AWS_IVS_INGEST_SERVER,
  };
};

// ========================
// OPCIÓN B: Crear un canal único por cada live (RECOMENDADO)
// ========================
const createIvsChannel = async (channelName) => {
  try {
    // 1. Crear el canal
    const createChannelCommand = new CreateChannelCommand({
      name: channelName,
      latencyMode: "LOW", // LOW o NORMAL
      type: "STANDARD", // STANDARD o BASIC
      authorized: false, // true si quieres restringir quién puede streamear
      tags: {
        Environment: "production",
        ManagedBy: "floreciendo-juntas",
      },
    });

    const channelResponse = await ivsClient.send(createChannelCommand);
    const channelArn = channelResponse.channel.arn;
    const playbackUrl = channelResponse.channel.playbackUrl;
    const ingestEndpoint = channelResponse.channel.ingestEndpoint;

    // 2. Crear el stream key
    const createStreamKeyCommand = new CreateStreamKeyCommand({
      channelArn: channelArn,
      tags: {
        ChannelName: channelName,
      },
    });

    const streamKeyResponse = await ivsClient.send(createStreamKeyCommand);
    const streamKey = streamKeyResponse.streamKey.value;

    console.log("✅ Canal IVS creado:", channelName);

    return {
      channelArn,
      playbackUrl,
      streamKey,
      ingestEndpoint,
    };
  } catch (error) {
    console.error("Error creando canal IVS:", error);
    throw new Error(`No se pudo crear el canal IVS: ${error.message}`);
  }
};

// ========================
// Eliminar un canal IVS
// ========================
const deleteIvsChannel = async (channelArn) => {
  try {
    const command = new DeleteChannelCommand({
      arn: channelArn,
    });

    await ivsClient.send(command);
    console.log("✅ Canal IVS eliminado:", channelArn);

    return true;
  } catch (error) {
    console.error("Error eliminando canal IVS:", error);
    throw error;
  }
};

// ========================
// Verificar si un stream está en vivo
// ========================
const checkStreamIsLive = async (channelArn) => {
  try {
    const command = new GetStreamCommand({
      channelArn: channelArn,
    });

    const response = await ivsClient.send(command);

    return {
      isLive: response.stream.state === "LIVE",
      streamInfo: {
        state: response.stream.state,
        health: response.stream.health,
        viewerCount: response.stream.viewerCount || 0,
        startTime: response.stream.startTime,
      },
    };
  } catch (error) {
    // Si no hay stream activo, AWS lanza ResourceNotFoundException
    if (error.name === "ResourceNotFoundException") {
      return {
        isLive: false,
        streamInfo: null,
      };
    }

    console.error("Error verificando estado del stream:", error);
    throw error;
  }
};

// ========================
// Obtener información de un canal
// ========================
const getChannelInfo = async (channelArn) => {
  try {
    const command = new GetChannelCommand({
      arn: channelArn,
    });

    const response = await ivsClient.send(command);
    return response.channel;
  } catch (error) {
    console.error("Error obteniendo info del canal:", error);
    throw error;
  }
};

module.exports = {
  getIvsChannelConfig,
  createIvsChannel,
  deleteIvsChannel,
  checkStreamIsLive,
  getChannelInfo,
};
