const {
  Cart,
  CartItem,
  Order,
  Product,
  User,
  OrderPayment,
  OrderItem,
} = require("../models");

const { sequelize } = require("../models");

const createOrderFromCart = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const userId = req.user.id;

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
    dueDate.setDate(dueDate.getDate() + 90);

    // 6️⃣ Crear Orden
    const order = await Order.create(
      {
        userId,
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

module.exports = {
  createOrderFromCart,
  getUserOrders,
  getOrderDetail,
};
