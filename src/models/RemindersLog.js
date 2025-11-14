const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const RemindersLog = sequelize.define(
  "RemindersLog",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    // 🔗 Relación con la orden asociada
    orderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "orders",
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
      comment: "Orden a la que pertenece el recordatorio",
    },

    // 🔗 Relación con el usuario
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Users",
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
      comment: "Usuario que recibe el recordatorio",
    },

    // 🔔 Tipo de recordatorio
    reminderType: {
      type: DataTypes.ENUM(
        "primer_aviso", // 1 semana después del pedido
        "segundo_aviso", // 1 mes después
        "tercer_aviso", // 2 meses después
        "vencimiento", // día límite
        "personalizado" // manual
      ),
      allowNull: false,
      comment: "Tipo de recordatorio enviado",
    },

    // 📅 Fecha y hora del envío
    sentAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: "Fecha y hora en la que se envió el recordatorio",
    },

    // 📤 Medio por el cual se envió
    channel: {
      type: DataTypes.ENUM("email", "sms", "notificacion", "whatsapp", "otro"),
      allowNull: false,
      defaultValue: "email",
      comment: "Medio de envío del recordatorio",
    },

    // 🧾 Resultado del envío
    status: {
      type: DataTypes.ENUM("enviado", "fallido", "pendiente"),
      allowNull: false,
      defaultValue: "enviado",
    },

    // 📄 Mensaje o detalle del recordatorio
    message: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Mensaje enviado al usuario o detalle del error",
    },
  },
  {
    tableName: "reminders_log",
    timestamps: true,
    indexes: [
      {
        fields: ["orderId"],
      },
      {
        fields: ["userId"],
      },
    ],
  }
);

module.exports = RemindersLog;
