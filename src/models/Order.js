const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Order = sequelize.define(
  "Order",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    // 🔗 Relación con el usuario que realiza la compra
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Users",
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },

    // 🔗 Relación con el carrito base del pedido
    cartId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "carts",
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },

    // 💰 Totales financieros
    totalAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      comment: "Monto total de la orden (sin importar método de pago)",
    },
    paidAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      comment: "Suma total pagada por el usuario",
    },
    remainingAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      comment: "Monto restante pendiente de pago",
    },
    stockDiscounted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: "Marca si el stock ya fue descontado tras el pago inicial",
    },

    // 🕒 Fechas importantes
    startDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: "Fecha en que se creó la orden",
    },
    dueDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      comment: "Fecha máxima para completar los pagos (máx. 3 meses)",
    },

    // 💳 Métodos y control de pago
    paymentMethod: {
      type: DataTypes.ENUM("efectivo", "tarjeta", "transferencia", "paypal"),
      allowNull: true,
      comment: "Método principal de pago elegido por el usuario",
    },

    // ⚙️ Estado general de la orden
    status: {
      type: DataTypes.ENUM(
        "pendiente", // Orden creada, sin pagos de productos
        "activo", // Tiene pagos, pero aún debe productos
        "pagado", // Productos totalmente pagados, falta costo de envío
        "envio_asignado", // Admin añadió shippingCost, client aún no lo paga
        "envio_pagado", // Envío pagado
        "completado", // Productos + envío pagados
        "vencido", // Pasó plazo y productos NO están 100% pagados
        "cancelado" // Cancelada manualmente
      ),
      allowNull: false,
      defaultValue: "pendiente",
    },

    // 🔎 Datos adicionales
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Notas administrativas o internas sobre el pedido",
    },
    shippingCost: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: 0.0,
    },

    shippingPaid: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },

    deliveryAddressId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "addresses",
        key: "id",
      },
      onDelete: "SET NULL",
    },
    trackingNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Número de guía o código de rastreo del envío",
    },

    carrier: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Nombre de la paquetería: DHL, FedEx, Estafeta, etc.",
    },

    trackingUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "URL directa para rastrear el paquete",
    },
  },
  {
    tableName: "orders",
    timestamps: true,
    hooks: {
      beforeCreate: (order) => {
        // Establecer dueDate automáticamente a 3 meses después
        const startDate = new Date();
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + 3);
        order.startDate = startDate;
        order.dueDate = dueDate;

        // Calcular saldo inicial
        order.remainingAmount = order.totalAmount - order.paidAmount;
      },
    },
  }
);

module.exports = Order;
