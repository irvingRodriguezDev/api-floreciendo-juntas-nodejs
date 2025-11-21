const { where } = require("sequelize");
const getS3Url = require("../helpers/getS3Url");
const { Cart, CartItem, Product, ProductImage } = require("../models");

/**
 * 🛒 Agregar producto al carrito
 */

const addItemToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity } = req.body;

    if (!productId || !quantity) {
      return res
        .status(400)
        .json({ message: "Producto y cantidad son requeridos" });
    }

    // Traemos el producto con su imagen
    const product = await Product.findByPk(productId, {
      include: [{ model: ProductImage, as: "image" }],
    });

    if (!product) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    if (quantity > product.stock) {
      return res
        .status(400)
        .json({ message: "Cantidad supera stock disponible" });
    }

    // Carrito
    let cart = await Cart.findOne({ where: { userId, status: "apartado" } });
    if (!cart) cart = await Cart.create({ userId });

    // Buscar si ya existe
    let item = await CartItem.findOne({
      where: { cartId: cart.id, productId },
      include: [
        {
          model: Product,
          as: "product",
          include: [{ model: ProductImage, as: "image" }],
        },
      ],
    });

    if (item) {
      const newQuantity = item.quantity + quantity;

      if (newQuantity > product.stock) {
        return res
          .status(400)
          .json({ message: "Cantidad supera stock disponible" });
      }

      item.quantity = newQuantity;
      item.unitPrice = product.price;
      item.subtotal = newQuantity * product.price;
      await item.save();
    } else {
      item = await CartItem.create({
        cartId: cart.id,
        productId,
        quantity,
        unitPrice: product.price,
        subtotal: quantity * product.price,
      });

      // volver a traer el item con su product + image
      item = await CartItem.findByPk(item.id, {
        include: [
          {
            model: Product,
            as: "product",
            include: [{ model: ProductImage, as: "image" }],
          },
        ],
      });
    }

    // 🔥 Convertir la imagen a URL de S3
    // Construir URL completa de la imagen
    let imageUrl = null;

    if (item.product.image && item.product.image.url) {
      imageUrl = getS3Url(item.product.image.url);
    }

    // Formatear respuesta completa ANTES de enviarla
    const formattedResponse = {
      message: "Producto agregado al carrito correctamente",
      cartId: item.cartId,
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      subtotal: item.subtotal,
      unitPrice: item.unitPrice,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,

      product: {
        ...item.product.toJSON(),
        image: item.product.image
          ? {
              ...item.product.image.toJSON(),
              url: imageUrl, // ← URL ya transformada
            }
          : null,
      },
    };

    // 🔥 Respuesta FINAL EXACTA como la necesita el frontend
    return res.json(formattedResponse);
  } catch (error) {
    console.error("Error al agregar al carrito:", error);
    return res
      .status(500)
      .json({ message: "Error al agregar producto al carrito" });
  }
};

/**SINCORINIZAR CARRITO */
const syncCart = async (req, res) => {
  try {
    const userId = req.user.id;
    // ⚠️ CORRECCIÓN 1: Acceder a 'req.body.items.items'
    // El payload ahora es { items: { items: [...] } }
    const guestItems = req.body.items.items;

    if (!guestItems || !Array.isArray(guestItems) || guestItems.length === 0) {
      return res.status(400).json({
        message: "No hay items para sincronizar.",
      });
    }

    // 1️⃣ Buscar o crear el carrito del usuario
    let cart = await Cart.findOne({
      where: { userId, status: "apartado" },
    });

    if (!cart) {
      cart = await Cart.create({ userId }); // status="apartado" por default
    }

    // 2️⃣ Obtener todos los items actuales del carrito
    const existingItems = await CartItem.findAll({
      where: { cartId: cart.id },
    });

    // Convertimos el carrito actual en un map (por productId)
    const cartMap = {};
    existingItems.forEach((i) => (cartMap[i.productId] = i));

    // 3️⃣ Procesar cada item del carrito del guest
    // ⚠️ CORRECCIÓN 2: Iterar sobre 'guestItems'
    for (const item of guestItems) {
      // ⚠️ CORRECCIÓN 3: Los datos están en 'item' y anidados en 'item.product'
      const product_id = item.product.product_id;
      const quantity = item.quantity;

      const product = await Product.findByPk(product_id);
      if (!product) continue;

      const stock = product.stock ?? 0;

      const finalQuantity = Math.min(quantity, stock);
      const unitPrice = product.price; // O item.unitPrice, pero se prefiere usar el de la DB
      const subtotal = unitPrice * finalQuantity;

      if (cartMap[product_id]) {
        // Ya existe → sumamos cantidades
        const newQuantity = Math.min(
          cartMap[product_id].quantity + finalQuantity,
          stock
        );

        await CartItem.update(
          {
            quantity: newQuantity,
            subtotal: newQuantity * unitPrice,
          },
          {
            where: {
              cartId: cart.id,
              productId: product_id,
            },
          }
        );
      } else {
        // No existe → crear nuevo
        await CartItem.create({
          cartId: cart.id,
          productId: product_id,
          quantity: finalQuantity,
          unitPrice,
          subtotal,
        });
      }
    }

    // 4️⃣ Obtener carrito actualizado con productos incluidos
    const updatedCart = await Cart.findOne({
      where: { id: cart.id },
      include: [
        {
          model: CartItem,
          as: "items",
          include: [
            {
              model: Product,
              as: "product",
            },
          ],
        },
      ],
    });

    return res.status(200).json({
      message: "Carrito sincronizado correctamente",
      cart: updatedCart,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Error al sincronizar el carrito",
    });
  }
};

const getUserCart = async (req, res) => {
  try {
    const userId = req.user.id;

    const cart = await Cart.findOne({
      where: { userId, status: "apartado" },
      include: [
        {
          model: CartItem,
          as: "items",
          include: [
            {
              model: Product,
              as: "product",
              include: [{ model: ProductImage, as: "image" }],
            },
          ],
        },
      ],
    });

    if (!cart) return res.status(200).json({ items: [], total: 0 });

    let total = 0;
    const cartWithImages = await Promise.all(
      cart.items.map(async (item) => {
        total += parseFloat(item.subtotal);
        let imageUrl = null;

        if (item.product?.image?.url) {
          imageUrl = await getS3Url(item.product.image.url);
        }

        return {
          ...item.toJSON(),
          product: {
            ...item.product.toJSON(),
            image: imageUrl
              ? { ...item.product.image.toJSON(), url: imageUrl }
              : null,
          },
        };
      })
    );

    res.json({ cartId: cart.id, total, items: cartWithImages });
  } catch (error) {
    console.error("Error al obtener carrito:", error);
    res.status(500).json({ message: "Error al obtener carrito" });
  }
};

/**
 * ✏️ Actualizar cantidad
 */
const updateCartItem = async (req, res) => {
  try {
    const { itemId } = req.params;

    const { quantity, product_id } = req.body;

    const item = await CartItem.findOne({
      where: {
        id: itemId,
        productId: product_id,
      },
      include: [{ model: Product, as: "product" }],
    });
    console.log(item, "el item");

    if (!item) {
      return res
        .status(404)
        .json({ message: "Producto no encontrado en el carrito" });
    }

    if (quantity > item.product.stock) {
      return res
        .status(400)
        .json({ message: "Cantidad excede stock disponible" });
    }

    item.quantity = quantity;
    item.subtotal = quantity * item.unitPrice;
    await item.save();

    res.json({ message: "Cantidad actualizada", item });
  } catch (error) {
    console.error("Error al actualizar cantidad:", error);
    res.status(500).json({ message: "Error al actualizar cantidad" });
  }
};

/**
 * ❌ Eliminar un producto del carrito
 */
const removeCartItem = async (req, res) => {
  try {
    const { itemId, productId } = req.params;

    const item = await CartItem.findByPk(itemId);
    if (!item) {
      return res.status(404).json({ message: "Item no encontrado" });
    }

    await item.destroy();

    res.json({ message: "Producto eliminado del carrito" });
  } catch (error) {
    console.error("Error al eliminar item:", error);
    res.status(500).json({ message: "Error al eliminar item" });
  }
};

/**
 * 🧹 Vaciar el carrito completo
 */
const clearCart = async (req, res) => {
  try {
    const userId = req.user.id;

    const cart = await Cart.findOne({ where: { userId, status: "apartado" } });
    if (!cart)
      return res.status(404).json({ message: "Carrito no encontrado" });

    await CartItem.destroy({ where: { cartId: cart.id } });
    cart.status = "abandonado";
    cart.save();
    res.json({ message: "Carrito vaciado correctamente" });
  } catch (error) {
    console.error("Error al vaciar carrito:", error);
    res.status(500).json({ message: "Error al vaciar carrito" });
  }
};

module.exports = {
  addItemToCart,
  getUserCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  syncCart,
};
