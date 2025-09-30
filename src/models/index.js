const User = require("./User");
const Role = require("./Role");
const Subscription = require("./Subscription");
const sequelize = require("../config/db");
// 🔹 Aquí definimos asociaciones, no en los modelos
Role.hasMany(User, { as: "users", foreignKey: "roleId" });
User.belongsTo(Role, { as: "role", foreignKey: "roleId" });

module.exports = { sequelize, User, Role, Subscription };
