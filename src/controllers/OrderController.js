const {
  Cart,
  CartItem,
  Order,
  Product,
  User,
  OrderPayment,
} = require("../models");

const createOrderFromCart = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1️⃣ Verificar que el usuario tenga un carrito activo
    const cart = await Cart.findOne({
      where: { userId, status: "apartado" },
      include: [
        {
          model: CartItem,
          as: "items",
          include: [{ model: Product, as: "product" }],
        },
      ],
    });

    if (!cart) {
      return res
        .status(404)
        .json({ message: "No se encontró un carrito activo" });
    }

    if (!cart.items || cart.items.length === 0) {
      return res.status(400).json({ message: "El carrito está vacío" });
    }

    // 2️⃣ Calcular totales
    const totalAmount = cart.items.reduce((sum, item) => {
      return sum + Number(item.unitPrice) * item.quantity;
    }, 0);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 90);
    // 3️⃣ Crear la orden (los hooks del modelo calculan dueDate y remainingAmount)
    const order = await Order.create({
      userId,
      cartId: cart.id,
      totalAmount,
      paidAmount: 0,
      status: "pendiente",
      paymentMethod: null, // se puede actualizar luego
      dueDate,
    });

    // 4️⃣ Cambiar estado del carrito
    await cart.update({ status: "pagando" });

    // 5️⃣ Respuesta
    res.status(201).json({
      message: "Orden creada correctamente",
      order,
    });
  } catch (error) {
    console.error("❌ Error al crear la orden:", error);
    res
      .status(500)
      .json({ message: "Error al crear la orden", error: error.message });
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

    return res.json({
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

module.exports = {
  createOrderFromCart,
  getUserOrders,
};
