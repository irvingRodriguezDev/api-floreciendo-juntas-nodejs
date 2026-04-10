// src/models/Subscription.js

const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); // Tu instancia de Sequelize
const User = require("./User"); // Importamos User

const Subscription = sequelize.define(
  "Subscription",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    // ID de la Suscripción de Stripe (solo se usa para pagos recurrentes)
    stripe_subscription_id: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true, // Debe ser único para evitar duplicados
    },
    stripe_customer_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // ID de la Sesión de Stripe (para cualquier tipo de pago)
    stripe_checkout_session_id: {
      type: DataTypes.STRING,
      allowNull: true, // Este sí debe existir siempre
      unique: true,
    },
    // Tipo de pago para saber cómo manejar la expiración
    subscription_type: {
      type: DataTypes.ENUM("ONETIME", "RECURRING"), // Usamos mayúsculas por convención
      allowNull: false,
    },
    // Fecha de inicio de la suscripción/pago
    start_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    // Fecha de expiración (para pagos ONETIME) o fecha en que se canceló/falló
    end_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Fecha del próximo cobro (solo para RECURRING)
    next_renewal: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    will_cancel_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_payment_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    ended_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Estado de la suscripción, refleja los estados de Stripe
    status: {
      type: DataTypes.ENUM(
        "incomplete",
        "pending",
        "active",
        "trialing",
        "past_due",
        "unpaid",
        "canceled",
        "expired",
        "incomplete_expired",
      ),
      defaultValue: "pending",
      allowNull: false,
    },
    // El ID del Price (plan) que se compró
    price_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // ID del usuario al que pertenece la suscripción
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: User,
        key: "id",
      },
    },
    // Campos de metadatos (opcionales)
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "Subscriptions",
    // Aseguramos que solo haya una suscripción activa por usuario si lo deseas
    // Aunque a veces se permite tener varias. Por ahora, no lo forzamos.
  },
);

// Relaciones
Subscription.belongsTo(User, { foreignKey: "userId", onDelete: "CASCADE" });
User.hasMany(Subscription, { foreignKey: "userId" });

module.exports = Subscription;
