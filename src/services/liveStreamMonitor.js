// ============================================
// Backend: services/liveStreamMonitor.js
// ============================================
const { checkStreamIsLive } = require("./awsIvsService");
const { Live } = require("../models");
const EventEmitter = require("events");

class LiveStreamMonitor extends EventEmitter {
  constructor() {
    super();
    this.activeChannels = new Map(); // channelArn -> { liveId, isLive, lastCheck }
    this.checkInterval = 15000; // Verificar cada 15 segundos en el servidor
    this.monitoringInterval = null;
  }

  // Iniciar monitoreo global
  startMonitoring() {
    if (this.monitoringInterval) return;

    console.log("🔴 Iniciando monitoreo de streams...");

    this.monitoringInterval = setInterval(async () => {
      await this.checkAllActiveStreams();
    }, this.checkInterval);
  }

  // Detener monitoreo
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log("⏹️  Monitoreo detenido");
    }
  }

  // Registrar un canal para monitorear
  async registerChannel(liveId, channelArn) {
    if (!this.activeChannels.has(channelArn)) {
      this.activeChannels.set(channelArn, {
        liveId,
        isLive: false,
        lastCheck: null,
      });

      // Verificar inmediatamente
      await this.checkStream(channelArn);
    }
  }

  // Desregistrar canal
  unregisterChannel(channelArn) {
    this.activeChannels.delete(channelArn);

    // Si no hay más canales, detener monitoreo
    if (this.activeChannels.size === 0) {
      this.stopMonitoring();
    }
  }

  // Verificar un stream específico
  async checkStream(channelArn) {
    try {
      const streamStatus = await checkStreamIsLive(channelArn);
      const channelData = this.activeChannels.get(channelArn);

      if (!channelData) return;

      const previousStatus = channelData.isLive;
      const newStatus = streamStatus.isLive;

      // Solo emitir si cambió el estado
      if (previousStatus !== newStatus) {
        console.log(
          `📡 Stream ${channelArn} cambió: ${previousStatus} → ${newStatus}`
        );

        // Actualizar en DB
        await Live.update(
          { status: newStatus ? "live" : "ended" },
          { where: { aws_channel_arn: channelArn } }
        );

        // Emitir evento para SSE
        this.emit("streamStatusChanged", {
          liveId: channelData.liveId,
          channelArn,
          isLive: newStatus,
          streamInfo: streamStatus.streamInfo,
          timestamp: new Date().toISOString(),
        });
      }

      // Actualizar caché
      channelData.isLive = newStatus;
      channelData.lastCheck = Date.now();
    } catch (error) {
      console.error(`Error verificando stream ${channelArn}:`, error);
    }
  }

  // Verificar todos los streams activos
  async checkAllActiveStreams() {
    const promises = Array.from(this.activeChannels.keys()).map((channelArn) =>
      this.checkStream(channelArn)
    );

    await Promise.allSettled(promises);
  }

  // Obtener estado actual de un canal
  getChannelStatus(channelArn) {
    return this.activeChannels.get(channelArn);
  }
}

// Singleton
const liveStreamMonitor = new LiveStreamMonitor();

module.exports = liveStreamMonitor;

// ============================================
// Backend: controllers/liveController.js (AGREGAR)
// ============================================

const liveStreamMonitor = require("../services/liveStreamMonitor");

// Endpoint SSE para recibir actualizaciones en tiempo real
const streamStatusSSE = async (req, res) => {
  const { id } = req.params;

  try {
    const live = await Live.findByPk(id);
    if (!live) {
      return res.status(404).json({ message: "Live no encontrado" });
    }

    // Configurar SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Registrar canal para monitoreo
    await liveStreamMonitor.registerChannel(live.id, live.aws_channel_arn);

    // Iniciar monitoreo si no está activo
    liveStreamMonitor.startMonitoring();

    // Enviar estado inicial
    const currentStatus = liveStreamMonitor.getChannelStatus(
      live.aws_channel_arn
    );
    res.write(
      `data: ${JSON.stringify({
        type: "initial",
        isLive: currentStatus?.isLive || false,
        liveId: live.id,
      })}\n\n`
    );

    // Listener para cambios de este stream
    const statusHandler = (data) => {
      if (data.liveId === live.id) {
        res.write(
          `data: ${JSON.stringify({
            type: "update",
            ...data,
          })}\n\n`
        );
      }
    };

    liveStreamMonitor.on("streamStatusChanged", statusHandler);

    // Cleanup al cerrar conexión
    req.on("close", () => {
      liveStreamMonitor.off("streamStatusChanged", statusHandler);
      liveStreamMonitor.unregisterChannel(live.aws_channel_arn);
      res.end();
    });
  } catch (error) {
    console.error("Error en SSE:", error);
    res.status(500).end();
  }
};

// Exportar
module.exports = {
  // ... tus otros controladores
  streamStatusSSE, // NUEVO
};

// ============================================
// Backend: routes/liveRoutes.js (AGREGAR)
// ============================================

router.get("/:id/stream-status-sse", liveController.streamStatusSSE);

// ============================================
// Frontend: hooks/useLiveStreamStatus.js
// ============================================

import { useEffect, useState } from "react";

export function useLiveStreamStatus(liveId) {
  const [isLive, setIsLive] = useState(false);
  const [streamInfo, setStreamInfo] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!liveId) return;

    let eventSource;

    const connect = () => {
      eventSource = new EventSource(`/api/lives/${liveId}/stream-status-sse`);

      eventSource.onopen = () => {
        console.log("✅ Conectado a SSE");
        setConnected(true);
      };

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("📡 Actualización SSE:", data);

        setIsLive(data.isLive);
        setStreamInfo(data.streamInfo);
      };

      eventSource.onerror = (error) => {
        console.error("❌ Error SSE:", error);
        setConnected(false);
        eventSource.close();

        // Reconectar después de 5 segundos
        setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [liveId]);

  return { isLive, streamInfo, connected };
}

// ============================================
// Frontend: Uso en componente
// ============================================

import { useLiveStreamStatus } from "./hooks/useLiveStreamStatus";
import IVSPlayerComponent from "./IVSPlayerComponent";

function LivePlayer({ liveId, playbackUrl, posterImage }) {
  const { isLive, streamInfo, connected } = useLiveStreamStatus(liveId);

  return (
    <div>
      {/* Indicador de conexión */}
      {!connected && (
        <div style={{ padding: "8px", background: "#ff9800", color: "#fff" }}>
          Reconectando...
        </div>
      )}

      {/* Reproductor - se renderiza siempre, maneja su propio estado */}
      <IVSPlayerComponent playbackUrl={playbackUrl} posterImage={posterImage} />

      {/* Info del stream */}
      {isLive && streamInfo && (
        <div style={{ padding: "12px", background: "#e8f5e9" }}>
          <strong>🔴 EN VIVO</strong>
          <div>Estado: {streamInfo.state}</div>
          <div>Salud: {streamInfo.health}</div>
          <div>Espectadores: {streamInfo.viewerCount}</div>
        </div>
      )}
    </div>
  );
}
