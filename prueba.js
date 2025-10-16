import {
  MediaConvertClient,
  GetJobCommand,
} from "@aws-sdk/client-mediaconvert";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import fetch from "node-fetch"; // Usamos node-fetch para la llamada HTTP

// Inicialización de clientes (usando process.env.REGION y el endpoint es opcional)
const mediaconvert = new MediaConvertClient({ region: process.env.REGION });
const cloudfront = new CloudFrontClient({ region: process.env.REGION });

// --- HANDLER DE LA FUNCIÓN LAMBDA B ---
export const handler = async (event) => {
  console.log("Evento EventBridge recibido:", JSON.stringify(event, null, 2));

  try {
    const detail = event.detail;
    const jobId = detail.jobId;
    // 2. Obtener detalles del trabajo para la URL de salida
    const getJobResp = await mediaconvert.send(
      new GetJobCommand({ Id: jobId })
    );

    if (detail.status !== "COMPLETE") {
      console.log(
        `Job ${jobId} status is ${detail.status}, saltando actualización.`
      );
      return { statusCode: 200 };
    }
    const s3InputKey = getJobResp.Job.Settings?.Inputs?.[0]?.FileInput;

    if (!s3InputKey) {
      throw new Error("Could not find S3 Input Key in job response.");
    }
    // Extraer la URL de destino de la configuración del trabajo
    const destination =
      getJobResp.Job.Settings?.OutputGroups?.[0]?.OutputGroupSettings
        ?.HlsGroupSettings?.Destination;

    if (!destination) {
      console.error(
        "ERROR: No se encontró la URL de destino en la respuesta del trabajo."
      );
      throw new Error("Missing output destination.");
    }
    const outputFolder = destination.replace(
      `s3://${process.env.OUTPUT_BUCKET}/`,
      ""
    );
    const fileNameWithExtension = s3InputKey.split("/").pop();
    const playlistBaseName = fileNameWithExtension.replace(/\.[^/.]+$/, "");
    const playlistName = `${playlistBaseName}.m3u8`;
    // 1. Obtener ID de Video y verificar la existencia
    const videoId = detail.userMetadata?.VideoId;
    if (!videoId) {
      // Esto indica un error de configuración en Lambda A o MediaConvert
      console.error(
        "ERROR: No se encontró el VideoId en UserMetadata. No se puede continuar."
      );
      throw new Error("Missing Video ID in job metadata.");
    }

    const playlistUrl = `https://${process.env.CLOUDFRONT_DOMAIN}/${outputFolder}${playlistName}`;

    console.log(`Video ID: ${videoId}, HLS URL: ${playlistUrl}`);

    // 3. LLAMADA AL ENDPOINT DE TU API NODE.JS
    const updateEndpoint = `${process.env.API_BASE_URL}/videos/update/${videoId}`;

    console.log(`Llamando a la API: ${updateEndpoint}`);

    const apiResponse = await fetch(updateEndpoint, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        // Usar una clave secreta para autenticar la llamada de Lambda a tu API
        Authorization: `Bearer ${process.env.API_SECRET_KEY}`,
      },
      body: JSON.stringify({
        hls_url: playlistUrl,
        status: "listo", // Marcar como procesado en tu BD
        jobId: jobId,
      }),
    });

    if (apiResponse.ok) {
      console.log(`✅ API actualizada exitosamente para ID ${videoId}`);
    } else {
      const errorText = await apiResponse.text();
      console.error(
        `❌ API Error para ID ${videoId}: ${apiResponse.status} - ${errorText}`
      );
      // Lanzamos un error para reintentos automáticos de EventBridge
      throw new Error(`API Update Failed: ${apiResponse.status}`);
    }

    // 4. Invalidación de CloudFront (Opcional pero recomendado)
    if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
      const invalidation = await cloudfront.send(
        new CreateInvalidationCommand({
          DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
          InvalidationBatch: {
            CallerReference: `inval-${Date.now()}-${jobId}`,
            // Invalida la carpeta completa para asegurar que todos los segmentos se actualicen.
            Paths: { Quantity: 1, Items: [`/${outputFolder}*`] },
          },
        })
      );
      console.log(
        `🚀 Invalidation Job Creado: ${invalidation.Invalidation?.Id}`
      );
    }

    return { statusCode: 200, body: "Video URL y BD actualizados." };
  } catch (err) {
    console.error("Error completo en handler de Lambda B:", err);
    throw err;
  }
};
