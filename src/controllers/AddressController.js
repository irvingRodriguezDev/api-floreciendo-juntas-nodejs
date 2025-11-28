const { Address } = require("../models");
const Order = require("../models/Order");

// 📌 Crear dirección
const createAddress = async (req, res) => {
  try {
    const userId = req.user.id; // viene desde middleware auth
    const data = req.body;

    // Si crea dirección con isDefault=true, quitar default de otras
    if (data.isDefault) {
      await Address.update({ isDefault: false }, { where: { userId } });
    }

    const address = await Address.create({
      ...data,
      userId,
    });

    res.status(201).json(address);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error creando dirección" });
  }
};

// 📌 Obtener todas las direcciones del usuario
const getMyAddresses = async (req, res) => {
  try {
    const userId = req.user.id;

    const addresses = await Address.findAll({
      where: { userId },
      order: [["isDefault", "DESC"]],
    });

    res.json(addresses);
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo direcciones" });
  }
};

// 📌 Actualizar una dirección
const updateAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId } = req.params;

    const address = await Address.findOne({
      where: { id: addressId, userId },
    });

    if (!address)
      return res.status(404).json({ error: "Dirección no encontrada" });

    const data = req.body;

    // Si esta nueva dirección se vuelve default
    if (data.isDefault === true) {
      await Address.update({ isDefault: false }, { where: { userId } });
    }

    await address.update(data);

    res.json(address);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error actualizando dirección" });
  }
};

// 📌 Eliminar una dirección
const deleteAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId } = req.params;

    const addr = await Address.findOne({
      where: { id: addressId, userId },
    });

    if (!addr)
      return res.status(404).json({ error: "Dirección no encontrada" });

    await addr.destroy();

    res.json({ message: "Dirección eliminada" });
  } catch (error) {
    res.status(500).json({ error: "Error eliminando dirección" });
  }
};

// 📌 Asignar dirección a orden
const assignAddressToOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;
    const { addressId } = req.body;

    const address = await Address.findOne({
      where: { id: addressId, userId },
    });

    if (!address)
      return res
        .status(404)
        .json({ error: "La dirección no pertenece al usuario" });

    const order = await Order.findOne({
      where: { id: orderId, userId },
    });

    if (!order)
      return res
        .status(404)
        .json({ error: "Orden no encontrada o no pertenece al usuario" });

    if (order.remainingAmount > 0) {
      return res.status(400).json({
        error: "Debes liquidar la orden antes de asignar una dirección",
      });
    }

    // asignar dirección
    await order.update({ shippingAddressId: addressId });

    res.json({ message: "Dirección asignada correctamente", order });
  } catch (error) {
    res.status(500).json({ error: "Error asignando dirección a la orden" });
  }
};

module.exports = {
  assignAddressToOrder,
  createAddress,
  updateAddress,
  getMyAddresses,
  deleteAddress,
};
