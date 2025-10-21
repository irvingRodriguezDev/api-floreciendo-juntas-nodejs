const sequelize = require("../config/db");

// Importar modelos
const User = require("./User");
const Role = require("./Role");
const Subscription = require("./Subscription");
const Course = require("./Course");
const System = require("./System");
const CourseVideo = require("./CourseVideo");
const ImageCourses = require("./ImageCourses");
const Reviews = require("./Reviews");
const CommunityPost = require("./CommunityPost");
const CommunityReaction = require("./CommunityReaction");
const CourseProgress = require("./CourseProgress");
const CommunityComment = require("./CommunityComment");

// Registrar modelos en el objeto db
const db = {
  sequelize,
  User,
  Role,
  Subscription,
  Course,
  System,
  ImageCourses,
  CourseVideo,
  Reviews,
  CommunityPost,
  CourseProgress,
  CommunityComment,
  CommunityReaction,
};

// 🔹 Asociaciones directas (si prefieres aquí algunas simples)
Role.hasMany(User, { as: "users", foreignKey: "roleId" });
User.belongsTo(Role, { as: "role", foreignKey: "roleId" });

// 🔹 Ejecutar las asociaciones definidas dentro de los modelos
Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

module.exports = db;
