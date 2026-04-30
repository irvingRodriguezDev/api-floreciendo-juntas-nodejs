const { Store, User } = require("../models"); // Ajusta a tus rutas
const sequelize = require("../config/db");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const createStore = async (req, res) => {
  try {
    const { name, description, address, latitude, longitude, phone } = req.body;

    const userId = req.user.id; // Del middleware JWT

    // ── 1. Validaciones de campos obligatorios ────────────────────────────────
    if (!name || !address || !phone) {
      return res.status(400).json({
        message: "Los campos nombre, dirección y teléfono son obligatorios.",
      });
    }

    if (!latitude || !longitude) {
      return res.status(400).json({
        message: "La ubicación geográfica es obligatoria.",
      });
    }

    // ── 2. Validar que venga un archivo de imagen ─────────────────────────────
    // req.file viene de multer con upload.single("file")
    // Si usas upload.fields([{ name: "file" }]), sería req.files?.file?.[0]
    if (!req.file) {
      return res.status(400).json({
        message: "La imagen del negocio es obligatoria.",
      });
    }

    // ── 3. Verificar si el usuario ya tiene una tienda ────────────────────────
    const existingStore = await Store.findOne({
      where: { userId: userId, isActive: true },
    });
    if (existingStore) {
      return res.status(400).json({
        message:
          "Ya tienes una tienda registrada. Actualiza la actual o contacta a soporte.",
      });
    }

    // ── 4. Subir imagen a S3 ANTES de crear el registro ───────────────────────
    // Así evitamos crear un registro huérfano si S3 falla.
    let imageUrl;
    try {
      imageUrl = await uploadToS3("stores", req.file, crypto.randomUUID());
    } catch (s3Error) {
      console.error("Error subiendo imagen a S3:", s3Error);
      return res.status(500).json({
        message: "Error al subir la imagen. Intenta de nuevo.",
        error: s3Error.message,
      });
    }

    // ── 5. Crear el registro en la DB con la URL real de S3 ───────────────────
    const newStore = await Store.create({
      name,
      description,
      address,
      latitude,
      longitude,
      phone,
      imageUrl, // URL real — nunca guardamos "temporal"
      userId,
      isActive: true,
    });

    return res.status(201).json({
      message: "¡Tienda dada de alta exitosamente!",
      store: {
        newStore,
        imageUrl: getS3Url(newStore.imageUrl),
        name: newStore.name,
        description: newStore.description,
        phone: newStore.phone,
        address: newStore.address,
        latitude: newStore.latitude,
        longitude: newStore.longitude,
        isActive: newStore.isActive,
      },
    });
  } catch (error) {
    console.error("Error al crear tienda:", error);
    return res.status(500).json({ message: "Error interno del servidor." });
  }
};

const getNearbyStores = async (req, res) => {
  try {
    const { lat, lng } = req.query; // Latitud y longitud del usuario (desde el GPS)
    const distance = 20; // Radio en Kilómetros

    if (!lat || !lng) {
      return res.status(400).json({
        message:
          "Se requiere la ubicación actual para buscar tiendas cercanas.",
      });
    }

    // Consulta usando SQL crudo dentro de Sequelize para el cálculo matemático
    const stores = await Store.findAll({
      attributes: {
        include: [
          [
            sequelize.literal(`(
          6371 * acos(
            cos(radians(${lat})) * cos(radians(latitude)) *
            cos(radians(longitude) - radians(${lng})) +
            sin(radians(${lat})) * sin(radians(latitude))
          )
        )`),
            "distance",
          ],
        ],
      },
      where: {
        // Condición 1: Que esté activa
        isActive: true,

        // Condición 2: El cálculo de distancia (usando el literal que ya tenías)
        distanciaCalculada: sequelize.where(
          sequelize.literal(`(
        6371 * acos(
          cos(radians(${lat})) * cos(radians(latitude)) *
          cos(radians(longitude) - radians(${lng})) +
          sin(radians(${lat})) * sin(radians(latitude))
        )
      )`),
          "<=",
          distance,
        ),
      },
      order: sequelize.col("distance"),
      limit: 30,
    });
    const formatted = stores.map((s) => ({
      ...s.toJSON(),
      imageUrl: s.imageUrl ? getS3Url(s.imageUrl) : "null",
    }));
    return res.status(200).json(formatted);
  } catch (error) {
    console.error("Error en búsqueda geográfica:", error);
    return res.status(500).json({ message: "Error al buscar tiendas." });
  }
};
const getMyStore = async (req, res) => {
  try {
    const userId = req.user.id;

    const store = await Store.findOne({
      where: {
        userId: userId,
        isActive: true,
      },
    });

    if (!store) {
      // Importante: Si la tienda existe pero isActive es false,
      // este 404 le dirá al frontend que puede mostrar el botón de "Registrar"
      return res.status(404).json({
        message: "No tienes ninguna tienda activa registrada.",
        hasInactiveStore: true, // Tip: esto ayuda al frontend a saber si debe ofrecer "Reactivar"
      });
    }

    return res.status(200).json({
      store: {
        ...store.get({ plain: true }),
        imageUrl: getS3Url(store.imageUrl),
      },
    });
  } catch (error) {
    console.error("Error al obtener la tienda del usuario:", error);
    return res.status(500).json({ message: "Error interno del servidor." });
  }
};
const updateStore = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // ── 1. Verificar que la tienda existe y pertenece al usuario ──────────────
    const store = await Store.findOne({ where: { id: id, userId: userId } });

    if (!store) {
      return res.status(404).json({
        message: "Tienda no encontrada o no tienes permiso para editarla.",
      });
    }

    // ── 2. Extraer solo los campos que vienen en el body (PATCH) ──────────────
    const allowedFields = [
      "name",
      "description",
      "address",
      "latitude",
      "longitude",
      "phone",
    ];
    const updates = {};

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    // ── 3. Si viene imagen nueva, subir a S3 y eliminar la anterior ───────────
    if (req.file) {
      // 3a. Subir nueva imagen
      let newImageUrl;
      try {
        newImageUrl = await uploadToS3("stores", req.file, crypto.randomUUID());
      } catch (s3Error) {
        console.error("Error subiendo imagen a S3:", s3Error);
        return res.status(500).json({
          message: "Error al subir la imagen. Intenta de nuevo.",
          error: s3Error.message,
        });
      }

      // 3b. Eliminar imagen anterior de S3 (si existe)
      if (store.imageUrl) {
        try {
          await deleteFromS3(store.imageUrl); // tu función para borrar de S3
        } catch (deleteError) {
          // No bloqueamos la actualización si falla el borrado
          console.warn(
            "No se pudo eliminar la imagen anterior de S3:",
            deleteError.message,
          );
        }
      }

      updates.imageUrl = newImageUrl;
    }

    // ── 4. Si no hay nada que actualizar ──────────────────────────────────────
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: "No se enviaron campos para actualizar.",
      });
    }

    // ── 5. Aplicar los cambios ────────────────────────────────────────────────
    await store.update(updates);
    await store.reload(); // Refresca la instancia con los datos actualizados

    return res.status(200).json({
      message: "¡Tienda actualizada correctamente!",
      store: {
        id: store.id,
        name: store.name,
        description: store.description,
        phone: store.phone,
        address: store.address,
        latitude: store.latitude,
        longitude: store.longitude,
        isActive: store.isActive,
        imageUrl: getS3Url(store.imageUrl),
      },
    });
  } catch (error) {
    console.error("Error al actualizar tienda:", error);
    return res.status(500).json({ message: "Error interno del servidor." });
  }
};

const deleteStore = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Buscar la tienda
    const store = await Store.findByPk(id);

    if (!store) {
      return res.status(404).json({
        message: "No se encontró ninguna tienda con el ID especificado",
      });
    }

    // 2. Cambio de estado: Pasamos isActive a false
    // Usamos update para que sea más explícito
    await store.update({ isActive: false, deletedAt: Date.now() });

    // 3. Respuesta profesional
    return res.status(200).json({
      message:
        "La tienda se ha desactivado exitosamente y ya no es visible en el mapa.",
      success: true,
    });
  } catch (error) {
    console.error("Error al desactivar tienda:", error);
    return res.status(500).json({
      message: "Ocurrió un error interno al intentar desactivar la tienda.",
    });
  }
};
module.exports = {
  createStore,
  getNearbyStores,
  getMyStore,
  deleteStore,
  updateStore,
};
