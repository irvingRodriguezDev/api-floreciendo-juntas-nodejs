const { Op } = require("sequelize");
const {
  Cart,
  CartItem,
  Order,
  Product,
  User,
  OrderPayment,
  OrderItem,
  Address,
} = require("../models");

const { sequelize } = require("../models");

const createOrderFromCart = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const userId = req.user.id;
    const { AddressId } = req.body;

    // 1️⃣ Verificar si ya existe una orden activa para el usuario
    const activeOrder = await Order.findOne({
      where: {
        userId,
        status: ["pendiente", "pagando", "aprobada", "procesando"],
      },
      transaction: t,
    });

    if (activeOrder) {
      await t.rollback();
      return res.status(400).json({
        message:
          "Ya tienes una orden activa. Finaliza ese proceso antes de crear una nueva.",
      });
    }

    // 2️⃣ Obtener carrito activo
    const cart = await Cart.findOne({
      where: { userId, status: "apartado" },
      include: [
        {
          model: CartItem,
          as: "items",
          include: [{ model: Product, as: "product" }],
        },
      ],
      transaction: t,
    });

    if (!cart) {
      await t.rollback();
      return res
        .status(404)
        .json({ message: "No se encontró un carrito activo." });
    }

    if (!cart.items || cart.items.length === 0) {
      await t.rollback();
      return res.status(400).json({ message: "El carrito está vacío." });
    }

    // 3️⃣ Validar stock
    for (const item of cart.items) {
      if (item.quantity > item.product.stock) {
        await t.rollback();
        return res.status(400).json({
          message: `Stock insuficiente para el producto: ${item.product.name}`,
          productId: item.product.id,
          availableStock: item.product.stock,
        });
      }
    }

    // 4️⃣ Calcular total
    const totalAmount = cart.items.reduce((sum, item) => {
      return sum + Number(item.unitPrice) * item.quantity;
    }, 0);

    // 5️⃣ Fecha de vencimiento (90 días)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 180);

    // 6️⃣ Crear Orden
    const order = await Order.create(
      {
        userId,
        deliveryAddressId: AddressId,
        cartId: cart.id,
        totalAmount,
        paidAmount: 0,
        status: "pendiente",
        paymentMethod: null,
        dueDate,
        stockDiscounted: false,
      },
      { transaction: t }
    );

    // 7️⃣ Crear OrderItems (detalle de orden)
    const orderItems = cart.items.map((item) => ({
      orderId: order.id,
      productId: item.product.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.quantity * item.unitPrice,
      productName: item.product.name,
      productImage: item.product.image,
    }));

    await OrderItem.bulkCreate(orderItems, { transaction: t });

    // 8️⃣ Actualizar carrito a "pagando"
    await cart.update({ status: "pagando" }, { transaction: t });

    // 9️⃣ Confirmar transacción
    await t.commit();

    return res.status(200).json({
      message: "Orden creada correctamente",
      order,
    });
  } catch (error) {
    await t.rollback();
    console.error("❌ Error al crear la orden:", error);

    return res.status(500).json({
      message: "Error al crear la orden",
      error: error.message,
    });
  }
};

const getUserOrders = async (req, res) => {
  try {
    const { userId } = req.params;

    // 🔍 Validar existencia de usuario (opcional)
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    // 🧾 Obtener órdenes con pagos asociados
    const orders = await Order.findAll({
      where: { userId },
      include: [
        {
          model: OrderPayment,
          as: "payments",
          attributes: [
            "id",
            "amount",
            "paymentMethod",
            "status",
            "reference",
            "type",
            "paymentDate",
          ],
          order: [["paymentDate", "DESC"]],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      orders,
    });
  } catch (error) {
    console.error("❌ Error al obtener órdenes del usuario:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

const getOrderDetail = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id; // seguridad: la orden debe ser del usuario autenticado

    const order = await Order.findOne({
      where: { id: orderId, userId },
      include: [
        {
          model: OrderItem,
          as: "items",
          include: [{ model: Product, as: "product" }],
        },
        {
          model: OrderPayment,
          as: "payments",
        },
        {
          model: Address,
          as: "address",
        },
      ],
    });

    if (!order) {
      return res.status(404).json({
        message: "No se encontró la orden o no pertenece al usuario",
      });
    }

    return res.status(200).json({
      message: "Detalle de la orden obtenido correctamente",
      order,
    });
  } catch (error) {
    console.error("❌ Error al obtener detalle de la orden:", error);
    return res.status(500).json({
      message: "Error al obtener detalle de la orden",
      error: error.message,
    });
  }
};

const getOrdersAdmin = async (req, res) => {
  try {
    // 🧾 Obtener órdenes con pagos asociados
    const orders = await Order.findAll({
      where: {
        status: {
          [Op.or]: ["pagado", "envio_asignado", "envio_pagado"],
        },
      },
      include: [
        {
          model: OrderPayment,
          as: "payments",
          attributes: [
            "id",
            "amount",
            "paymentMethod",
            "status",
            "reference",
            "type",
            "paymentDate",
          ],
          order: [["paymentDate", "DESC"]],
        },
        {
          model: User,
          as: "user",
          attributes: ["name", "email", "phone"],
        },
        {
          model: Address,
          as: "address",
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error("❌ Error al obtener órdenes:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

const assignamentShippingCost = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { shippingCost } = req.body;

    const order = await Order.findByPk(orderId, {
      include: [
        { model: Address, as: "address" },
        { model: User, as: "user" },
      ],
    });

    if (!order) {
      return res.status(404).json({
        message: "No se encontró la orden con el ID especificado",
      });
    }

    // No permitir modificar envío si ya fue pagado
    if (order.shippingPaid) {
      return res.status(400).json({
        message: "El costo de envío ya fue pagado y no puede modificarse.",
      });
    }

    const newShipping = parseFloat(shippingCost) || 0;

    // Actualizar SOLO campos de envío
    await order.update({
      shippingCost: newShipping,
      shippingPaid: false, // por si acaso
      status: "envio_asignado",
    });

    const updatedOrder = await Order.findByPk(orderId, {
      include: [
        { model: Address, as: "address" },
        { model: User, as: "user" },
      ],
    });

    return res.status(200).json({
      message: "Costo de envío asignado correctamente",
      order: updatedOrder,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Error interno del servidor",
    });
  }
};
const getOrdersActiveAdmin = async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: {
        status: "activo", // no necesitas el OR si solo es un valor
      },
      include: [
        {
          model: OrderPayment,
          as: "payments",
          attributes: [
            "id",
            "amount",
            "paymentMethod",
            "status",
            "reference",
            "type",
            "paymentDate",
          ],
          separate: true, // 🔥 IMPORTANTE para que el order funcione
          order: [["paymentDate", "DESC"]], // 🔥 Ahora sí ordena los pagos
        },
        {
          model: User,
          as: "user",
          attributes: ["name", "email", "phone"],
        },
        {
          model: Address,
          as: "address",
        },
      ],
      order: [["createdAt", "DESC"]], // Orden de órdenes
    });

    return res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error("❌ Error al obtener órdenes:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};
const getOrdersCompletedAdmin = async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: {
        status: "pagado", // no necesitas el OR si solo es un valor
      },
      include: [
        {
          model: OrderPayment,
          as: "payments",
          attributes: [
            "id",
            "amount",
            "paymentMethod",
            "status",
            "reference",
            "type",
            "paymentDate",
          ],
          separate: true, // 🔥 IMPORTANTE para que el order funcione
          order: [["paymentDate", "DESC"]], // 🔥 Ahora sí ordena los pagos
        },
        {
          model: User,
          as: "user",
          attributes: ["name", "email", "phone"],
        },
        {
          model: Address,
          as: "address",
        },
      ],
      order: [["createdAt", "DESC"]], // Orden de órdenes
    });

    return res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error("❌ Error al obtener órdenes:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};
const getOrdersShippPayed = async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: {
        status: "envio_pagado", // no necesitas el OR si solo es un valor
      },
      include: [
        {
          model: OrderPayment,
          as: "payments",
          attributes: [
            "id",
            "amount",
            "paymentMethod",
            "status",
            "reference",
            "type",
            "paymentDate",
          ],
          separate: true, // 🔥 IMPORTANTE para que el order funcione
          order: [["paymentDate", "DESC"]], // 🔥 Ahora sí ordena los pagos
        },
        {
          model: User,
          as: "user",
          attributes: ["name", "email", "phone"],
        },
        {
          model: Address,
          as: "address",
        },
      ],
      order: [["createdAt", "DESC"]], // Orden de órdenes
    });

    return res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error("❌ Error al obtener órdenes:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};
const getOrdersShipped = async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: {
        status: "completado", // no necesitas el OR si solo es un valor
      },
      include: [
        {
          model: OrderPayment,
          as: "payments",
          attributes: [
            "id",
            "amount",
            "paymentMethod",
            "status",
            "reference",
            "type",
            "paymentDate",
          ],
          separate: true, // 🔥 IMPORTANTE para que el order funcione
          order: [["paymentDate", "DESC"]], // 🔥 Ahora sí ordena los pagos
        },
        {
          model: User,
          as: "user",
          attributes: ["name", "email", "phone"],
        },
        {
          model: Address,
          as: "address",
        },
      ],
      order: [["createdAt", "DESC"]], // Orden de órdenes
    });

    return res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error("❌ Error al obtener órdenes:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
};

const updateShippingInfo = async (req, res) => {
  try {
    const { id } = req.params;
    const { trackingNumber, carrier, trackingUrl } = req.body;

    // Validaciones básicas
    if (!trackingNumber || !carrier) {
      return res.status(400).json({
        success: false,
        message: "trackingNumber y carrier son obligatorios.",
      });
    }

    // Buscar orden
    const order = await Order.findByPk(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Orden no encontrada",
      });
    }

    // Verificar que el envío ya haya sido pagado
    if (!order.shippingPaid) {
      return res.status(400).json({
        success: false,
        message: "El envío aún no está pagado. No puedes asignar guía.",
      });
    }

    // Actualizamos campos de envío
    order.trackingNumber = trackingNumber;
    order.carrier = carrier;
    switch (carrier) {
      case "DHL":
        order.trackingUrl = `https://www.dhl.com/mx-es/home/rastreo.html?tracking-id=${trackingNumber}&submit=1`;
        break;

      case "Fedex":
        order.trackingUrl = `https://www.fedex.com/fedextrack?trknbr=${trackingNumber}`;
        break;

      case "Estafeta":
        order.trackingUrl = `https://www.estafeta.com/Herramientas/Rastreo?guia=${trackingNumber}`;
        break;

      default:
        order.trackingUrl = null; // fallback
        break;
    }

    // Estado final
    order.status = "completado";

    await order.save();

    return res.json({
      success: true,
      message: "Información de envío registrada y orden completada.",
      order,
    });
  } catch (error) {
    console.error("❌ Error al actualizar tracking:", error);
    res.status(500).json({
      success: false,
      message: "Error interno al actualizar la información de envío",
      error: error.message,
    });
  }
};

const getOrderDetailAdmin = async (req, res) => {
  try {
    const { order_id } = req.params;

    const order = await Order.findOne({
      where: { id: order_id },
      include: [
        {
          model: OrderItem,
          as: "items",
          include: [{ model: Product, as: "product" }],
        },
        {
          model: OrderPayment,
          as: "payments",
        },
        {
          model: Address,
          as: "address",
        },
      ],
    });

    if (!order) {
      return res.status(404).json({
        message: "No se encontró la orden ",
      });
    }

    return res.status(200).json({
      message: "Detalle de la orden obtenido correctamente",
      order,
    });
  } catch (error) {
    console.error("❌ Error al obtener detalle de la orden:", error);
    return res.status(500).json({
      message: "Error al obtener detalle de la orden",
      error: error.message,
    });
  }
};

module.exports = {
  createOrderFromCart,
  getUserOrders,
  getOrderDetail,
  getOrdersAdmin,
  assignamentShippingCost,
  getOrdersActiveAdmin,
  getOrdersCompletedAdmin,
  getOrdersShippPayed,
  getOrdersShipped,
  updateShippingInfo,
  getOrderDetailAdmin,
};
