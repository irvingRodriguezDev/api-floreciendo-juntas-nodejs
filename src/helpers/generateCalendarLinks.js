const moment = require("moment-timezone");

/**
 * 📅 Genera enlaces para agregar evento a diferentes calendarios
 */
const generateCalendarLinks = (event, ticketUrl, ticketId) => {
  const moment = require("moment-timezone");

  // ✅ Fechas en México para Google Calendar & ICS
  const startDateLocal = moment(event.startDate)
    .tz("America/Mexico_City")
    .format("YYYYMMDDTHHmmss");

  const endDateLocal = event.endDate
    ? moment(event.endDate).tz("America/Mexico_City").format("YYYYMMDDTHHmmss")
    : moment(event.startDate)
        .tz("America/Mexico_City")
        .add(2, "hours")
        .format("YYYYMMDDTHHmmss");

  // ✅ Fechas en UTC para Outlook & Yahoo
  const startDateUTC = moment(event.startDate)
    .utc()
    .format("YYYYMMDDTHHmmss[Z]");

  const endDateUTC = event.endDate
    ? moment(event.endDate).utc().format("YYYYMMDDTHHmmss[Z]")
    : moment(event.startDate)
        .utc()
        .add(2, "hours")
        .format("YYYYMMDDTHHmmss[Z]");

  // ✅ Limpieza de descripción HTML
  const cleanDescription = event.description
    ? event.description
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim()
    : "";

  const title = encodeURIComponent(event.title);
  const location = encodeURIComponent(event.location || "Por confirmar");
  const description = encodeURIComponent(
    `${cleanDescription}\n\nTu boleto: ${ticketUrl}\n\n Por favor presenta tu boleto al ingresar al evento.`
  );

  // ✅ URL del backend asegurada en HTTPS
  const backendUrl = (
    process.env.BACKEND_URL || "https://api.floreciendojuntas.com"
  ).replace(/\/$/, "");

  const icsDownloadUrl = `${backendUrl}/api/events/${event.id}/${ticketId}/calendar`;

  return {
    // ✅ Google Calendar
    google: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDateLocal}/${endDateLocal}&details=${description}&location=${location}&ctz=America/Mexico_City`,

    // ✅ Apple Calendar / iOS — usa webcal:// para abrir la app directament
    apple: `webcal://${backendUrl.replace(/^https?:\/\//, "")}/api/events/${event.id}/${ticketId}/calendar`,

    // ✅ Outlook.com + App de escritori
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?subject=${title}&startdt=${startDateUTC}&enddt=${endDateUTC}&body=${description}&location=${location}&path=/calendar/action/compose&rru=addevent`,

    // ✅ Yahoo Calendar
    yahoo: `https://calendar.yahoo.com/?v=60&title=${title}&st=${startDateUTC}&et=${endDateUTC}&desc=${description}&in_loc=${location}`,

    // ✅ Descarga directa del .ics
    ics: icsDownloadUrl,
  };
};

/**
 * 📄 Genera archivo .ics para Apple Calendar, Outlook Desktop, etc.
 */
const generateICSFile = (event, ticketUrl, ticketId) => {
  const startDate = moment(event.startDate)
    .tz("America/Mexico_City")
    .format("YYYYMMDDTHHmmss");

  const endDate = event.endDate
    ? moment(event.endDate).tz("America/Mexico_City").format("YYYYMMDDTHHmmss")
    : moment(event.startDate)
        .tz("America/Mexico_City")
        .add(2, "hours")
        .format("YYYYMMDDTHHmmss");

  const now = moment().utc().format("YYYYMMDDTHHmmss");

  const cleanDescription = (event.description || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

  const escapeICS = (str) =>
    (str || "")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\n/g, "\\n");

  let ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Tu Empresa//Ticket System//ES
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-TIMEZONE:America/Mexico_City
BEGIN:VEVENT
UID:ticket-${ticketId}@tuempresa.com
DTSTAMP:${now}Z
DTSTART;TZID=America/Mexico_City:${startDate}
DTEND;TZID=America/Mexico_City:${endDate}
SUMMARY:${escapeICS(event.title)}
DESCRIPTION:${escapeICS(cleanDescription)}\\n\\nTu boleto: ${ticketUrl}
LOCATION:${escapeICS(event.location || "Por confirmar")}
STATUS:CONFIRMED
SEQUENCE:0
END:VEVENT
END:VCALENDAR`;

  return ics.replace(/\n/g, "\r\n");
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
