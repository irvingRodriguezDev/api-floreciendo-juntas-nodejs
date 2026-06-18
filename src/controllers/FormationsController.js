const convertImageIfNeeded = require("../helpers/convertImages");
const getS3Url = require("../helpers/getS3Url");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const {
  Formations,
  FormationsModules,
  DeliveryFormations,
  User,
} = require("../models"); // Ajusta según tu estructura de modelos

const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fs = require("fs");
const path = require('path');
const fontkit = require("@pdf-lib/fontkit");

// src/controllers/FormationsController.js

// Controlador para Formations
// Funciones: index (listar activos), create, update, remove (soft-delete -> desactivar)

async function GetActiveFormations(req, res) {
  try {
    const formations = await Formations.findAll({
      where: { is_active: true },
      order: [["createdAt", "ASC"]],
    });
    const formatedFormations = formations.map((f) => ({
      id: f.id,
      name: f.name,
      diploma: f.diploma ? getS3Url(f.diploma) : null, // Aquí puedes formatear la URL si es necesario
      createdAt: f.createdAt,
    }));
    return res.json({ success: true, data: formatedFormations });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: "Error al listar formaciones" });
  }
}

async function createFormation(req, res) {
  try {
    const { name } = req.body;
    if (!name)
      return res
        .status(400)
        .json({ success: false, message: "El campo name es requerido" });

    // Crear registro primero para obtener id y usarlo en el path del archivo
    const formation = await Formations.create({
      name,
      diploma: "diploma",
      is_active: true, // siempre por defecto activo
    });

    // Si se envió un archivo (ej. multer -> req.file), subir a S3 y guardar path
    if (req.file) {
      const s3Path = await uploadToS3("formations", req.file, formation.id);
      formation.diploma = s3Path;
      await formation.save();
    }

    return res.status(201).json({ success: true, data: formation });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: "Error al crear la formación" });
  }
}

async function updateFormation(req, res) {
  try {
    const { id } = req.params;
    const { name, is_active } = req.body;

    const formation = await Formations.findByPk(id);
    if (!formation)
      return res
        .status(404)
        .json({ success: false, message: "Formación no encontrada" });

    // Actualizar campos permitidos
    if (typeof name !== "undefined") formation.name = name;
    if (typeof is_active !== "undefined")
      formation.is_active = Boolean(is_active);
    formation.diploma = formation.diploma || "diploma"; // Mantener el valor actual o asignar "diploma" si es null
    // Si se envía un nuevo diploma, subir y guardar path (reemplaza el anterior)

    if (req.file) {
      const s3Path = await uploadToS3("formations", req.file, id);

      formation.diploma = s3Path;
      // Nota: si deseas eliminar el archivo anterior en S3, implementa y llama a un helper de eliminación aquí
    }

    await formation.save();

    return res.json({ success: true, data: formation });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: "Error al actualizar la formación" });
  }
}

async function deleteFormation(req, res) {
  try {
    const { id } = req.params;
    const formation = await Formations.findByPk(id);
    if (!formation)
      return res
        .status(404)
        .json({ success: false, message: "Formación no encontrada" });

    // Soft-delete: desactivar la formación
    formation.is_active = false;
    await formation.save();

    // Si quieres también eliminar el archivo en S3, añade un helper deleteFromS3 y llámalo aquí:
    // if (formation.diploma) await deleteFromS3(formation.diploma);

    return res.json({ success: true, message: "Formación desactivada" });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: "Error al eliminar la formación" });
  }
}

const getFormationModules = async (req, res) => {
  try {
    const { id } = req.params;

    const formation = await Formations.findByPk(id);

    if (!formation)
      return res
        .status(404)
        .json({ success: false, message: "Formación no encontrada" });

    const modules = await FormationsModules.findAll({
      where: { formationId: id }, // Filtramos directamente aquí
      include: [
        {
          model: Formations,
          as: "formation", // <--- Cambiado para que coincida con el belongsTo
          attributes: [], // Mantiene esto vacío si no quieres los datos de la formación en el JSON
        },
      ],
    });

    return res.json({ success: true, data: modules });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: "Error al obtener los módulos" });
  }
};

const showFormation = async (req, res) => {
  try {
    const { id } = req.params;
    const formation = await Formations.findByPk(id);
    if (!formation)
      return res
        .status(404)
        .json({ success: false, message: "Formación no encontrada" });
    const formatedFormation = {
      id: formation.id,
      name: formation.name,
      diploma: formation.diploma ? getS3Url(formation.diploma) : null, // Aquí puedes formatear la URL si es necesario
      createdAt: formation.createdAt,
    };
    return res.json({
      success: true,
      data: formatedFormation,
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: "Error al obtener la formación" });
  }
};

const showFormationProgress = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const formation = await Formations.findByPk(id, {
      include: [
        {
          model: FormationsModules,
          as: "modules_formations",
          include: [
            {
              model: DeliveryFormations,
              as: "deliveries",
              where: { userId },
              required: false,
            },
          ],
        },
      ],
      order: [
        [{ model: FormationsModules, as: "modules_formations" }, "id", "ASC"],
      ],
    });

    if (!formation) {
      return res.status(404).json({ message: "Formación no encontrada" });
    }

    const formationData = formation.toJSON();

    formationData.diploma = formationData.diploma
      ? getS3Url(formationData.diploma)
      : null;

    return res.status(200).json(formationData);
  } catch (error) {
    console.error("Error al obtener el progreso de la formación:", error);
    return res.status(500).json({ message: "Error interno del servidor" });
  }
};

const submitModuleDelivery = async (req, res) => {
  try {
    const { moduleFormationId } = req.body;
    const userId = req.user.id;
    const file = req.file;

    // 1. Validaciones iniciales
    if (!moduleFormationId) {
      return res
        .status(400)
        .json({ message: "El ID del módulo es obligatorio." });
    }

    if (!file) {
      return res
        .status(400)
        .json({ message: "No se ha adjuntado ninguna evidencia." });
    }

    // 2. Procesar la imagen primero (HEIC -> JPG / optimizar a WEBP)
    let processedFile;
    try {
      processedFile = await convertImageIfNeeded(file);
    } catch (conversionError) {
      console.error("Error al procesar la imagen:", conversionError);
      return res
        .status(500)
        .json({ message: "Error al optimizar el formato de la imagen." });
    }

    // 3. PASO CLAVE: Crear o asegurar el registro en la Base de Datos primero
    // Ponemos un string vacío temporalmente en 'urlDelivery' porque es obligatorio (allowNull: false)
    const [delivery, created] = await DeliveryFormations.findOrCreate({
      where: {
        moduleFormationId,
        userId,
      },
      defaults: {
        urlDelivery: "PENDING_UPLOAD",
        status: "submitted", // Forzamos el estado de enviado en revisión
        accepted: false,
        submitDate: new Date(),
      },
    });

    // Si ya existía el registro, lo preparamos reseteando sus campos para la nueva revisión
    if (!created) {
      delivery.status = "submitted";
      delivery.accepted = false;
      delivery.submitDate = new Date();
      delivery.acceptedDate = null;
      // Guardamos este estado inicial por si S3 llega a fallar
      await delivery.save();
    }

    // 4. Subir a AWS S3 usando el ID real de la entrega recién obtenido
    let s3Location;
    try {
      // Ahora sí le pasamos el ID definitivo de la tabla: delivery.id
      const s3Response = await uploadToS3(
        "formations/deliveries",
        processedFile,
        delivery.id + Date.now(), // 👈 Aquí inyectamos el ID de la base de datos
      );

      s3Location = s3Response.Location || s3Response;
    } catch (s3Error) {
      console.error("Error al subir a S3:", s3Error);

      // Control de frustración: Si S3 falla y el registro era nuevo, lo limpiamos para no dejar datos corruptos
      if (created) {
        await delivery.destroy({ force: true }); // Borrado físico inmediato
      }
      return res.status(500).json({
        message: "Error al guardar el archivo en el almacenamiento en la nube.",
      });
    }

    // 5. Actualizar el registro con la URL final de S3
    delivery.urlDelivery = s3Location;
    await delivery.save();

    return res.status(200).json({
      message: created
        ? "Evidencia enviada con éxito."
        : "Evidencia actualizada con éxito.",
      delivery,
    });
  } catch (error) {
    console.error("Error en el controlador de entregables:", error);
    return res
      .status(500)
      .json({ message: "Error interno del servidor al procesar la entrega." });
  }
};

const getPendingDeliveries = async (req, res) => {
  try {
    // 1. Extraer y parsear los parámetros de paginación desde req.query
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;

    // Calcular el desplazamiento (offset)
    const offset = (page - 1) * limit;

    // 2. Ejecutar la consulta usando findAndCountAll
    const { count, rows: deliveries } =
      await DeliveryFormations.findAndCountAll({
        where: {
          status: "submitted", // Mantenemos la cola de revisión de enviados
        },
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "name", "email"],
          },
          {
            model: FormationsModules,
            as: "module",
            attributes: ["id", "name", "formationId"],
          },
        ],
        // Orden cronológico estricto: Primero en entrar, primero en ser evaluado
        order: [["submitDate", "ASC"]],
        limit: limit,
        offset: offset,
      });

    // 3. Formatear los registros de la página actual aplicando tu función getS3Url
    const formatedDeliveries = deliveries.map((d) => ({
      id: d.id,
      moduleFormationId: d.moduleFormationId,
      userId: d.userId,
      urlDelivery: getS3Url(d.urlDelivery), // Formateamos la URL de AWS S3 para el frontend
      status: d.status,
      accepted: d.accepted,
      submitDate: d.submitDate,
      acceptedDate: d.acceptedDate,
      user: d.user,
      module: d.module,
    }));

    // 4. Calcular el total de páginas
    const totalPages = Math.ceil(count / limit);

    // 5. Retornar la respuesta estructurada con su metadata de paginación
    return res.status(200).json({
      data: {
        totalItems: count, // Cuántos pendientes hay en total en la base de datos
        totalPages: totalPages, // Cuántas páginas se forman
        currentPage: page, // En qué página está parado el admin
        limit: limit, // El límite actual de la vista
        deliveries: formatedDeliveries, // El array ya mapeado y con las URLs de S3 listas
      },
    });
  } catch (error) {
    console.error("Error al obtener entregables para administración:", error);
    return res
      .status(500)
      .json({ message: "Error al cargar la lista de entregables." });
  }
};
const reviewModuleDelivery = async (req, res) => {
  try {
    const { id } = req.params; // ID del entregable (delivery_formations.id)
    const { status } = req.body; // Se espera "accepted" o "rejected"

    // 1. Validar que el estatus enviado sea correcto
    if (!["accepted", "rejected"].includes(status)) {
      return res.status(400).json({
        message: "Estatus inválido. Debe ser 'accepted' o 'rejected'.",
      });
    }

    // 2. Buscar el registro de la entrega
    const delivery = await DeliveryFormations.findByPk(id);

    if (!delivery) {
      return res
        .status(404)
        .json({ message: "El entregable solicitado no existe." });
    }

    // 3. Aplicar lógica de negocio según la decisión del admin
    if (status === "accepted") {
      delivery.status = "accepted";
      delivery.accepted = true;
      delivery.acceptedDate = new Date(); // Seteamos la fecha de aprobación
    } else {
      delivery.status = "rejected";
      delivery.accepted = false;
      delivery.acceptedDate = null; // Nos aseguramos de limpiar la fecha si venía de un estado previo
      delivery.urlDelivery = null; // Opcional: Limpiar la URL de la entrega rechazada para que el alumno vuelva a subir una nueva evidencia
    }

    // 4. Guardar los cambios en la base de datos
    await delivery.save();

    return res.status(200).json({
      message:
        status === "accepted"
          ? "La práctica ha sido aprobada con éxito."
          : "La práctica ha sido rechazada.",
      delivery,
    });
  } catch (error) {
    console.error("Error al evaluar el entregable:", error);
    return res.status(500).json({
      message: "Error interno del servidor al procesar la evaluación.",
    });
  }
};

const downloadDiploma = async (req, res) => {
  try {
    const { userName, formationId } = req.query;

    if (!userName) {
      return res
        .status(400)
        .json({ message: "El nombre del usuario es obligatorio" });
    }

    if (!formationId) {
      return res
        .status(400)
        .json({ message: "El ID de la formación es obligatorio" });
    }

    // 1️⃣ Buscar la formación y verificar que tenga diploma
    const formation = await Formations.findByPk(formationId);

    if (!formation) {
      return res.status(404).json({ message: "Formación no encontrada" });
    }

    if (!formation.diploma) {
      return res
        .status(404)
        .json({ message: "Esta formación no tiene diploma disponible" });
    }

    // 2️⃣ Verificar que el usuario tenga todas las entregas aceptadas
    const userId = req.user.id;

    const modules = await FormationsModules.findAll({
      where: { formationId },
      include: [
        {
          model: DeliveryFormations,
          as: "deliveries",
          where: { userId, accepted: true },
          required: true, // INNER JOIN: solo módulos con entrega aceptada
        },
      ],
    });

    const totalModules = await FormationsModules.count({ where: { formationId } });

    if (modules.length < totalModules) {
      return res.status(403).json({
        message: "Debes tener todas las evidencias aceptadas para descargar el diploma",
      });
    }

    // 3️⃣ Obtener URL pública del diploma base desde S3
    const pdfUrl = getS3Url(formation.diploma);

    // 4️⃣ Descargar el PDF base desde S3
    const existingPdfBytes = await fetch(pdfUrl).then((r) => r.arrayBuffer());
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // ✅ Registrar fontkit
    pdfDoc.registerFontkit(fontkit);

    const pages = pdfDoc.getPages();
    const page = pages[0];
    const { width } = page.getSize();

    // 5️⃣ Cargar fuente Ephesis-Regular (misma que en cursos)
    const fontPath = path.join(__dirname, "../fonts/Ephesis-Regular.ttf");
    const fontBytes = fs.readFileSync(fontPath);
    const customFont = await pdfDoc.embedFont(fontBytes);

    // 6️⃣ Área disponible y posición vertical
    const nameAreaLeft = 85;
    const nameAreaRight = width - 75;
    const availableWidth = nameAreaRight - nameAreaLeft;
    const yPosition = 465;

    // 7️⃣ Calcular tamaño de fuente dinámico
    let textSize = 55;
    const minTextSize = 35;
    let textWidth = customFont.widthOfTextAtSize(userName, textSize);

    while (textWidth > availableWidth && textSize > minTextSize) {
      textSize -= 1;
      textWidth = customFont.widthOfTextAtSize(userName, textSize);
    }

    if (textWidth > availableWidth) {
      textSize = (availableWidth / textWidth) * textSize;
      textWidth = customFont.widthOfTextAtSize(userName, textSize);
    }

    // 8️⃣ Centrado real
    const xCentered = nameAreaLeft + (availableWidth - textWidth) / 2;

    // 9️⃣ Dibujar el nombre en el PDF
    page.drawText(userName, {
      x: xCentered,
      y: yPosition,
      size: textSize,
      font: customFont,
      color: rgb(0.0, 0.0, 0.0),
    });

    const pdfBytes = await pdfDoc.save();

    // 🔟 Enviar PDF para descarga
    const fileName = `Diploma_${userName.replace(/ /g, "_")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error("Error generando diploma de formación:", error);
    res.status(500).json({ message: "Error generando el diploma" });
  }
};

module.exports = {
  GetActiveFormations,
  createFormation,
  updateFormation,
  deleteFormation,
  getFormationModules,
  showFormation,
  showFormationProgress,
  submitModuleDelivery,
  getPendingDeliveries,
  reviewModuleDelivery,
  downloadDiploma,
};
