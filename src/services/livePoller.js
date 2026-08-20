// livePoller.js
const { getStreamViewers } = require("./awsIvsService");

const activePollers = new Map();

const startPoller = (io, liveId, channelArn) => {
  if (activePollers.has(liveId)) return;

  console.log(`▶️ Poller iniciado → live:${liveId}`);

  const intervalId = setInterval(async () => {
    const room = `live_${liveId}`;
    const roomClients = io.sockets.adapter.rooms.get(room);

    if (!roomClients || roomClients.size === 0) return;

    try {
      const { viewers, isLive, health } = await getStreamViewers(channelArn);

      io.to(room).emit("live_viewer_count", {
        liveId,
        viewers,
        isLive,
        health,
      });

      // ⚠️ ELIMINADO: No llamamos a stopPoller(liveId) si !isLive.
      // Dejamos que el Grace Period del webhook controle el ciclo de vida del Poller.
    } catch (err) {
      console.error(`❌ Poller error live:${liveId}`, err.message);
    }
  }, 90000);

  activePollers.set(liveId, intervalId);
};

const stopPoller = (liveId) => {
  const intervalId = activePollers.get(liveId);
  if (!intervalId) return;
  clearInterval(intervalId);
  activePollers.delete(liveId);
  console.log(`⏹️ Poller detenido → live:${liveId}`);
};

module.exports = { startPoller, stopPoller };
