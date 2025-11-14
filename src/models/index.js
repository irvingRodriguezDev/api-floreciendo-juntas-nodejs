const sequelize = require("../config/db");

// 🧩 Importa primero los modelos base (sin dependencias)
const Role = require("./Role");
const User = require("./User");

// Luego los modelos que dependen de User o Role
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
const CertificateCourse = require("./CertificateCourse");
const Event = require("./Event");
const Ticket = require("./Ticket");
const Product = require("./Product");
const ProductImage = require("./ProductImages");
const Cart = require("./Cart");
const CartItem = require("./CartItem");
const Order = require("./Order");
const OrderPayment = require("./OrderPayment");
const RemindersLog = require("./RemindersLog");
// Registrar modelos
const db = {
  sequelize,
  Role,
  User,
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
  CertificateCourse,
  Event,
  Ticket,
  Product,
  ProductImage,
  Cart,
  CartItem,
  Order,
  OrderPayment,
  RemindersLog,
};

// 🔹 Relaciones entre Role y User
Role.hasMany(User, { as: "users", foreignKey: "roleId" });
User.belongsTo(Role, { as: "role", foreignKey: "roleId" });

// 🔹 Relaciones entre Product y ProductImage
Product.hasOne(ProductImage, { foreignKey: "product_id", as: "image" });
ProductImage.belongsTo(Product, { foreignKey: "product_id" });

// 🔹 Relaciones entre User y Cart
User.hasMany(Cart, { foreignKey: "userId", as: "carts" });
Cart.belongsTo(User, { foreignKey: "userId", as: "user" });
// Relación: un carrito tiene muchos items
Cart.hasMany(CartItem, { foreignKey: "cartId", as: "items" });
CartItem.belongsTo(Cart, { foreignKey: "cartId", as: "cart" });

// Relación: un producto puede estar en muchos items
Product.hasMany(CartItem, { foreignKey: "productId", as: "cartItems" });
CartItem.belongsTo(Product, { foreignKey: "productId", as: "product" });

Order.hasMany(OrderPayment, { foreignKey: "orderId", as: "payments" });
OrderPayment.belongsTo(Order, { foreignKey: "orderId", as: "order" });
Order.belongsTo(User, {
  as: "user",
  foreignKey: "userId",
});
Order.hasMany(RemindersLog, { foreignKey: "orderId", as: "reminders" });
RemindersLog.belongsTo(Order, { foreignKey: "orderId", as: "order" });

User.hasMany(RemindersLog, { foreignKey: "userId", as: "reminders" });
RemindersLog.belongsTo(User, { foreignKey: "userId", as: "user" });
// 🔹 Ejecutar asociaciones internas (si existen)
Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

module.exports = db;
