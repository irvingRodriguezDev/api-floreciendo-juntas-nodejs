// templates/templateC_Liquid.js
const templateA_Full = require("./templateA_Full");

// Reutilizamos el diseño visual de la Plantilla A adaptando el encabezado
module.exports = (data) => {
  return templateA_Full(data).replace(
    '¡Tus accesos están <span style="color: #ec4899;">Listos</span>! 🎉',
    '¡Liquidación <span style="color: #ec4899;">Completada</span>! 🎉',
  );
};
