// helpers/streamDisconnectManager.js
const pendingDisconnects = new Map(); // channelArn -> Timeout

const scheduleDisconnect = (channelArn, callback, delayMs = 90000) => {
  // Si ya había un temporizador corriendo, lo limpiamos para no acumular
  cancelDisconnect(channelArn);

  console.log(`⏱️ Grace Period iniciado (90s) para canal: ${channelArn}`);
  const timer = setTimeout(async () => {
    pendingDisconnects.delete(channelArn);
    await callback();
  }, delayMs);

  pendingDisconnects.set(channelArn, timer);
};

const cancelDisconnect = (channelArn) => {
  if (pendingDisconnects.has(channelArn)) {
    clearTimeout(pendingDisconnects.get(channelArn));
    pendingDisconnects.delete(channelArn);
    console.log(
      `✅ Reconexión detectada. Grace Period cancelado para: ${channelArn}`
    );
    return true;
  }
  return false;
};

module.exports = { scheduleDisconnect, cancelDisconnect };
