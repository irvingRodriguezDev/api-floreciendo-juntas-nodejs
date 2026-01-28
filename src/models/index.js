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
const OrderItem = require("./OrdenItem");
const Address = require("./Adress");
const PointEvent = require("./PointEvent");
const MonthlyPrize = require("./MonthlyPrize");
const RaffleWinner = require("./RaffleWinner");
const Live = require("./Live");
const LiveComment = require("./LiveComment");
const StripeEvent = require("./StripeEvents");
const Post = require("./Post");
const PostMedia = require("./PostMedia");
const PostComment = require("./PostComment");
const PostLike = require("./PostLike");
const NotificationToken = require("./NotificationToken");
const Notifications = require("./Notifications");
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
  OrderItem,
  Address,
  PointEvent,
  MonthlyPrize,
  RaffleWinner,
  Live,
  LiveComment,
  StripeEvent,
  Post,
  PostComment,
  PostLike,
  PostMedia,
  NotificationToken,
  Notifications,
};

// 🔹 Relaciones entre Role y User
Role.hasMany(User, { as: "users", foreignKey: "roleId" });
User.belongsTo(Role, { as: "role", foreignKey: "roleId" });
User.hasOne(Subscription, {
  foreignKey: "userId",
  as: "subscription",
});
//usuario que recibe la notificacion
Notifications.belongsTo(User, {
  foreignKey: "userId",
  as: "receiver",
});
//usuario que genero la accion
Notifications.belongsTo(User, {
  foreignKey: "actorId",
  as: "actor",
});
User.hasMany(Address, { foreignKey: "userId" });
Address.belongsTo(User, { foreignKey: "userId" });
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
// Una orden tiene muchos orderItems
Order.hasMany(OrderItem, { foreignKey: "orderId", as: "items" });
OrderItem.belongsTo(Order, { foreignKey: "orderId", as: "order" });
Order.belongsTo(Address, { foreignKey: "deliveryAddressId", as: "address" });
// Un producto puede estar en muchas órdenes
Product.hasMany(OrderItem, { foreignKey: "productId", as: "orderItems" });
OrderItem.belongsTo(Product, { foreignKey: "productId", as: "product" });
Order.hasMany(RemindersLog, { foreignKey: "orderId", as: "reminders" });
RemindersLog.belongsTo(Order, { foreignKey: "orderId", as: "order" });

User.hasMany(RemindersLog, { foreignKey: "userId", as: "reminders" });
RemindersLog.belongsTo(User, { foreignKey: "userId", as: "user" });
User.hasMany(PointEvent, {
  foreignKey: "user_id",
  as: "points_history",
});

PointEvent.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});
User.hasMany(Subscription, {
  foreignKey: "userId",
  as: "subscriptions",
});
Subscription.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
});

MonthlyPrize.hasOne(RaffleWinner, {
  foreignKey: "prize_id",
  as: "winner",
});
RaffleWinner.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

RaffleWinner.belongsTo(MonthlyPrize, {
  foreignKey: "prize_id",
  as: "prize",
});
// ==========================
// Post ↔ User
// ==========================
Post.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
});

User.hasMany(Post, {
  foreignKey: "userId",
  as: "posts",
});

// ==========================
// Post ↔ Comments
// ==========================
Post.hasMany(PostComment, {
  foreignKey: "postId",
  as: "comments",
});

PostComment.belongsTo(Post, {
  foreignKey: "postId",
  as: "post",
});

PostComment.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
});

User.hasMany(PostComment, {
  foreignKey: "userId",
  as: "comments",
});

// ==========================
// Post ↔ Likes
// ==========================
Post.hasMany(PostLike, {
  foreignKey: "postId",
  as: "likes",
});

PostLike.belongsTo(Post, {
  foreignKey: "postId",
  as: "post",
});

PostLike.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
});
NotificationToken.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
});
User.hasMany(NotificationToken, { foreignKey: "user_id" });

User.hasMany(PostLike, {
  foreignKey: "userId",
  as: "likes",
});

// ==========================
// Media polimórfica
// ==========================

// 🖼 Media de Posts
Post.hasMany(PostMedia, {
  foreignKey: "modelId",
  constraints: false,
  scope: {
    modelType: "post",
  },
  as: "media",
});

// 🖼 Media de Comments
PostComment.hasMany(PostMedia, {
  foreignKey: "modelId",
  constraints: false,
  scope: {
    modelType: "comment",
  },
  as: "media",
});
//notificaciones

// 🔹 Ejecutar asociaciones internas (si existen)
Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

module.exports = db;
