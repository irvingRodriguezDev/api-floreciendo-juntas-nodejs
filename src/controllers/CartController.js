const getS3Url = require("../helpers/getS3Url");
const { Cart, CartItem, Product, ProductImage } = require("../models");

/**
 * 🛒 Agregar producto al carrito
 */
const addItemToCart = async (req, res) => {
  try {
    const userId = req.user.id; // ⚠️ viene del token JWT
    const { productId, quantity } = req.body;

    if (!productId || !quantity) {
      return res
        .status(400)
        .json({ message: "Producto y cantidad son requeridos" });
    }

    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    if (quantity > product.stock) {
      return res
        .status(400)
        .json({ message: "Cantidad supera stock disponible" });
    }

    // Buscar carrito activo o crearlo
    let cart = await Cart.findOne({ where: { userId, status: "apartado" } });
    if (!cart) cart = await Cart.create({ userId });

    // Buscar si el producto ya existe en el carrito
    const existingItem = await CartItem.findOne({
      where: { cartId: cart.id, productId },
    });

    if (existingItem) {
      const newQuantity = existingItem.quantity + quantity;
      if (newQuantity > product.stock) {
        return res
          .status(400)
          .json({ message: "Cantidad supera stock disponible" });
      }

      existingItem.quantity = newQuantity;
      existingItem.unitPrice = product.price;
      existingItem.subtotal = newQuantity * product.price;
      await existingItem.save();
    } else {
      await CartItem.create({
        cartId: cart.id,
        productId,
        quantity,
        unitPrice: product.price,
        subtotal: quantity * product.price,
      });
    }

    res.json({ message: "Producto agregado al carrito correctamente" });
  } catch (error) {
    console.error("Error al agregar al carrito:", error);
    res.status(500).json({ message: "Error al agregar producto al carrito" });
  }
};

/**SINCORINIZAR CARRITO */
const syncCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
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

    // Convertimos el carrito actual en un map
    const cartMap = {};
    existingItems.forEach((i) => (cartMap[i.productId] = i));

    // 3️⃣ Procesar cada item del carrito del guest
    for (const item of items) {
      const { product_id, quantity } = item;

      const product = await Product.findByPk(product_id);
      if (!product) continue;

      const stock = product.stock ?? 0;

      const finalQuantity = Math.min(quantity, stock);
      const unitPrice = product.price;
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
    const { quantity } = req.body;

    const item = await CartItem.findByPk(itemId, {
      include: [{ model: Product, as: "product" }],
    });

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
    const { itemId } = req.params;

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
