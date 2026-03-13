const moment = require("moment-timezone");

/**
 * 📅 Genera enlaces para agregar evento a diferentes calendarios
 * Ya no recibe ticketUrl ni ticketId — el correo es solo confirmación de compra
 */
const generateCalendarLinks = (event) => {
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

  // ✅ Descripción sin ticketUrl — solo info del evento
  const description = encodeURIComponent(
    `${cleanDescription}\n\nRecuerda descargar tu boleto desde tu perfil antes del evento.`,
  );

  const backendUrl = (
    process.env.BACKEND_URL || "https://api.floreciendojuntas.com"
  ).replace(/\/$/, "");

  // ✅ ICS apunta al evento general, no a un ticket individual
  const icsDownloadUrl = `${backendUrl}/api/events/${event.id}/calendar`;

  return {
    google: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDateLocal}/${endDateLocal}&details=${description}&location=${location}&ctz=America/Mexico_City`,
    apple: `webcal://${backendUrl.replace(/^https?:\/\//, "")}/api/events/${event.id}/calendar`,
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?subject=${title}&startdt=${startDateUTC}&enddt=${endDateUTC}&body=${description}&location=${location}&path=/calendar/action/compose&rru=addevent`,
    yahoo: `https://calendar.yahoo.com/?v=60&title=${title}&st=${startDateUTC}&et=${endDateUTC}&desc=${description}&in_loc=${location}`,
    ics: icsDownloadUrl,
  };
};

const LOGOS = {
  google: `${process.env.AWS_CDN_URL}/production/statics/logo-google-calendar.png`,
  outlook: `${process.env.AWS_CDN_URL}/production/statics/logo-outlook-calendar.avif`,
  apple: `${process.env.AWS_CDN_URL}/production/statics/logo-apple-calendar.png`,
  yahoo: `${process.env.AWS_CDN_URL}/production/statics/logo-yahoo-calendar.png`,
  ics: `${process.env.AWS_CDN_URL}/production/statics/logo-isc-calendar.png`,
};

/**
 * 📄 Genera archivo .ics — sin ticketUrl ni ticketId
 */
const generateICSFile = (event) => {
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

  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Tu Empresa//Ticket System//ES
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-TIMEZONE:America/Mexico_City
BEGIN:VEVENT
UID:event-${event.id}@floreciendojuntas.com
DTSTAMP:${now}Z
DTSTART;TZID=America/Mexico_City:${startDate}
DTEND;TZID=America/Mexico_City:${endDate}
SUMMARY:${escapeICS(event.title)}
DESCRIPTION:${escapeICS(cleanDescription)}\\n\\nRecuerda descargar tu boleto desde tu perfil antes del evento.
LOCATION:${escapeICS(event.location || "Por confirmar")}
STATUS:CONFIRMED
SEQUENCE:0
END:VEVENT
END:VCALENDAR`;

  return ics.replace(/\n/g, "\r\n");
};

/**
 * 💾 Guarda archivo ICS en S3 — sin ticketId, clave por evento
 */
const saveICSToS3 = async (event, _unused, uploadToS3) => {
  const icsContent = generateICSFile(event);

  const icsFileObject = {
    originalname: `evento_${event.id}.ics`,
    buffer: Buffer.from(icsContent, "utf-8"),
    mimetype: "text/calendar",
  };

  // Clave por evento — se reutiliza si se llama varias veces
  const s3Key = await uploadToS3("calendar-events", icsFileObject, event.id);
  return s3Key;
};

/**
 * 📧 Genera HTML para botones de calendario en email — sin cambios
 */
const generateCalendarButtonsHTML = (calendarLinks) => {
  return `
    <div style="margin: 32px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 420px; margin: 0 auto;">
        <tr>
          <!-- Google -->
          <td width="50%" style="padding: 5px;">
            <a href="${calendarLinks.google}" target="_blank" style="display: block; text-decoration: none; background: #ffffff; border: 1px solid #f0e0e8; border-radius: 12px; padding: 14px 16px; text-align: left;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td width="32" valign="middle">
                    <img src="${LOGOS.google}" width="22" height="22" alt="Google Calendar" style="display:block; border:0;">
                  </td>
                  <td valign="middle" style="padding-left: 10px;">
                    <span style="font-size: 12px; font-weight: 500; color: #2d1a24; font-family: 'DM Sans', sans-serif; display: block; line-height: 1;">Google</span>
                    <span style="font-size: 10px; color: #b08090; font-family: 'DM Sans', sans-serif;">Calendar</span>
                  </td>
                </tr>
              </table>
            </a>
          </td>

          <!-- Outlook -->
          <td width="50%" style="padding: 5px;">
            <a href="${calendarLinks.outlook}" target="_blank" style="display: block; text-decoration: none; background: #ffffff; border: 1px solid #f0e0e8; border-radius: 12px; padding: 14px 16px; text-align: left;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td width="32" valign="middle">
                    <img src="${LOGOS.outlook}" width="22" height="22" alt="Outlook Calendar" style="display:block; border:0;">
                  </td>
                  <td valign="middle" style="padding-left: 10px;">
                    <span style="font-size: 12px; font-weight: 500; color: #2d1a24; font-family: 'DM Sans', sans-serif; display: block; line-height: 1;">Outlook</span>
                    <span style="font-size: 10px; color: #b08090; font-family: 'DM Sans', sans-serif;">Microsoft</span>
                  </td>
                </tr>
              </table>
            </a>
          </td>
        </tr>

        <tr>
          <!-- Apple -->
          <td width="50%" style="padding: 5px;">
            <a href="${calendarLinks.apple}" style="display: block; text-decoration: none; background: #ffffff; border: 1px solid #f0e0e8; border-radius: 12px; padding: 14px 16px; text-align: left;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td width="32" valign="middle">
                    <img src="${LOGOS.apple}" width="22" height="22" alt="Apple Calendar" style="display:block; border:0;">
                  </td>
                  <td valign="middle" style="padding-left: 10px;">
                    <span style="font-size: 12px; font-weight: 500; color: #2d1a24; font-family: 'DM Sans', sans-serif; display: block; line-height: 1;">Apple</span>
                    <span style="font-size: 10px; color: #b08090; font-family: 'DM Sans', sans-serif;">Calendar</span>
                  </td>
                </tr>
              </table>
            </a>
          </td>

          <!-- Yahoo -->
          <td width="50%" style="padding: 5px;">
            <a href="${calendarLinks.yahoo}" target="_blank" style="display: block; text-decoration: none; background: #ffffff; border: 1px solid #f0e0e8; border-radius: 12px; padding: 14px 16px; text-align: left;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td width="32" valign="middle">
                    <img src="${LOGOS.yahoo}" width="22" height="22" alt="Yahoo Calendar" style="display:block; border:0;">
                  </td>
                  <td valign="middle" style="padding-left: 10px;">
                    <span style="font-size: 12px; font-weight: 500; color: #2d1a24; font-family: 'DM Sans', sans-serif; display: block; line-height: 1;">Yahoo</span>
                    <span style="font-size: 10px; color: #b08090; font-family: 'DM Sans', sans-serif;">Calendar</span>
                  </td>
                </tr>
              </table>
            </a>
          </td>
        </tr>

        <!-- ICS full width -->
        <tr>
          <td colspan="2" style="padding: 5px;">
            <a href="${calendarLinks.ics}" style="display: block; text-decoration: none; background: #fdf6f9; border: 1px dashed #f3b9cd; border-radius: 12px; padding: 14px 20px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td width="32" valign="middle">
                    <img src="${LOGOS.ics}" width="22" height="22" alt="ICS" style="display:block; border:0;">
                  </td>
                  <td valign="middle" style="padding-left: 10px;">
                    <span style="font-size: 12px; font-weight: 500; color: #2d1a24; font-family: 'DM Sans', sans-serif;">Descargar archivo .ICS</span>
                    <span style="font-size: 10px; color: #b08090; font-family: 'DM Sans', sans-serif; display: block;">Compatible con cualquier app de calendario</span>
                  </td>
                  <td valign="middle" align="right">
                    <span style="font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #ec4899; font-family: 'DM Sans', sans-serif; font-weight: 500;">Universal</span>
                  </td>
                </tr>
              </table>
            </a>
          </td>
        </tr>
      </table>
    </div>
  `;
};

module.exports = {
  generateCalendarLinks,
  generateICSFile,
  saveICSToS3,
  generateCalendarButtonsHTML,
};
