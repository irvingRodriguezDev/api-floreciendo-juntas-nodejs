const moment = require("moment-timezone");

/**
 * 📅 Genera enlaces para agregar evento a diferentes calendarios
 */
const generateCalendarLinks = (event, ticketUrl, ticketId) => {
  // Formatear fechas para calendarios (ISO 8601 sin guiones ni dos puntos)
  const startDate = moment(event.startDate)
    .tz("America/Mexico_City")
    .format("YYYYMMDDTHHmmss");

  // Si no hay endDate, asumir 2 horas de duración
  const endDate = event.endDate
    ? moment(event.endDate).tz("America/Mexico_City").format("YYYYMMDDTHHmmss")
    : moment(event.startDate)
        .tz("America/Mexico_City")
        .add(12, "hours")
        .format("YYYYMMDDTHHmmss");

  // Limpiar descripción de HTML
  const cleanDescription = event.description
    ? event.description
        .replace(/<[^>]*>/g, "") // Eliminar todas las etiquetas HTML
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\r\n/g, "\n")
        .trim()
    : "";

  const title = encodeURIComponent(event.title);
  const location = encodeURIComponent(event.location || "Por confirmar");
  const description = encodeURIComponent(
    `${cleanDescription}\n\nTu boleto: ${ticketUrl}\n\nPor favor presenta tu boleto al ingresar al evento.`
  );

  // URL base del backend para descargar el .ics
  const backendUrl = process.env.BACKEND_URL || "http://localhost:5000";

  return {
    // 🟢 Google Calendar
    google: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDate}/${endDate}&details=${description}&location=${location}&ctz=America/Mexico_City`,

    // 🍎 Apple Calendar / iCal (descarga archivo .ics)
    apple: `${backendUrl}/api/events/${event.id}/${ticketId}/calendar`,

    // 🔵 Outlook.com
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?subject=${title}&startdt=${event.startDate}&enddt=${event.endDate || event.startDate}&location=${location}&body=${description}&path=/calendar/action/compose&rru=addevent`,

    // 🟣 Yahoo Calendar
    yahoo: `https://calendar.yahoo.com/?v=60&title=${title}&st=${startDate}&et=${endDate}&desc=${description}&in_loc=${location}`,

    // 📥 Descarga directa ICS
    ics: `${backendUrl}/api/events/${event.id}/${ticketId}/calendar`,
  };
};

/**
 * 📄 Genera archivo .ics para Apple Calendar, Outlook Desktop, etc.
 */
const generateICSFile = (event, ticketUrl) => {
  const startDate = moment(event.startDate)
    .tz("America/Mexico_City")
    .format("YYYYMMDDTHHmmss");

  const endDate = event.endDate
    ? moment(event.endDate).tz("America/Mexico_City").format("YYYYMMDDTHHmmss")
    : moment(event.startDate)
        .tz("America/Mexico_City")
        .add(2, "hours")
        .format("YYYYMMDDTHHmmss");

  const now = moment().format("YYYYMMDDTHHmmss");

  // Limpiar descripción de HTML
  const cleanDescription = event.description
    ? event.description
        .replace(/<[^>]*>/g, "") // Eliminar todas las etiquetas HTML
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\r\n/g, "\n")
        .trim()
    : "";

  // Escape de caracteres especiales en ICS
  const escapeICS = (str) => {
    if (!str) return "";
    return str
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\n/g, "\\n");
  };

  const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Tu Empresa//Ticket System//ES
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-TIMEZONE:America/Mexico_City
BEGIN:VTIMEZONE
TZID:America/Mexico_City
BEGIN:STANDARD
DTSTART:20201101T020000
TZOFFSETFROM:-0500
TZOFFSETTO:-0600
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:20210314T020000
TZOFFSETFROM:-0600
TZOFFSETTO:-0500
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:ticket-${event.id}-${now}@tuempresa.com
DTSTAMP:${now}Z
DTSTART;TZID=America/Mexico_City:${startDate}
DTEND;TZID=America/Mexico_City:${endDate}
SUMMARY:${escapeICS(event.title)}
DESCRIPTION:${escapeICS(cleanDescription)}\\n\\nTu boleto: ${ticketUrl}\\n\\nPor favor presenta tu boleto xd al ingresar al evento.
LOCATION:${escapeICS(event.location || "Por confirmar")}
STATUS:CONFIRMED
SEQUENCE:0
BEGIN:VALARM
TRIGGER:-PT24H
ACTION:DISPLAY
DESCRIPTION:Recordatorio: ${escapeICS(event.title)} es mañana
END:VALARM
BEGIN:VALARM
TRIGGER:-PT2H
ACTION:DISPLAY
DESCRIPTION:Recordatorio: ${escapeICS(event.title)} comienza en 2 horas
END:VALARM
END:VEVENT
END:VCALENDAR`;

  return icsContent;
};

/**
 * 💾 Guarda archivo ICS y lo sube a S3
 */
const saveICSToS3 = async (event, ticketUrl, uploadToS3, ticketId) => {
  const icsContent = generateICSFile(event, ticketUrl);

  const icsFileObject = {
    originalname: `evento_${event.id}_ticket_${ticketId}.ics`,
    buffer: Buffer.from(icsContent, "utf-8"),
    mimetype: "text/calendar",
  };

  const s3Key = await uploadToS3("calendar-events", icsFileObject, ticketId);
  return s3Key;
};

/**
 * 📧 Genera HTML para botones de calendario en email
 */
const generateCalendarButtonsHTML = (calendarLinks) => {
  return `
    <div style="margin: 30px 0; text-align: center;">
      <h3 style="color: #374151; margin-bottom: 15px;">📅 Agregar a tu calendario</h3>
      <div style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;">
        
        <a href="${calendarLinks.google}" 
           target="_blank"
           style="background: #4285f4; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">
          📅 Google Calendar
        </a>
        
        <a href="${calendarLinks.apple}" 
           download="evento.ics"
           style="background: #000000; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">
          🍎 Apple Calendar
        </a>
        
        <a href="${calendarLinks.outlook}" 
           target="_blank"
           style="background: #0078d4; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">
          📧 Outlook
        </a>
        
        <a href="${calendarLinks.yahoo}" 
           target="_blank"
           style="background: #6001d2; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">
          🟣 Yahoo
        </a>
        
      </div>
      <p style="color: #6b7280; font-size: 12px; margin-top: 15px;">
        Selecciona tu calendario favorito para recibir recordatorios automáticos
      </p>
    </div>
  `;
};

module.exports = {
  generateCalendarLinks,
  generateICSFile,
  saveICSToS3,
  generateCalendarButtonsHTML,
};
