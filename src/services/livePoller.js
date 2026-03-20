// livePoller.js
const { getStreamViewers } = require("./awsIvsService");

const activePollers = new Map(); // liveId → intervalId

const startPoller = (io, liveId, channelArn) => {
  if (activePollers.has(liveId)) return; // ya hay uno corriendo

  console.log(`▶️ Poller iniciado → live:${liveId}`);

  const intervalId = setInterval(async () => {
    const room = `live_${liveId}`;
    const roomClients = io.sockets.adapter.rooms.get(room);

    // Si no hay nadie en la sala, no gastamos la llamada a IVS
    if (!roomClients || roomClients.size === 0) return;

    try {
      const { viewers, isLive, health } = await getStreamViewers(channelArn);

      io.to(room).emit("live_viewer_count", {
        liveId,
        viewers,
        isLive,
        health,
      });

      // Si IVS dice que ya no está live, limpiamos
      if (!isLive) stopPoller(liveId);
    } catch (err) {
      console.error(`❌ Poller error live:${liveId}`, err.message);
    }
  }, 15000); // cada 15s — IVS actualiza aprox cada 5-10s de todas formas

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
