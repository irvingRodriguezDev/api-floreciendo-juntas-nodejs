const { Product, ProductImage } = require("../models");
const slugify = require("slugify");
const { uploadToS3 } = require("../middlewares/uploadCourseImage");
const getS3Url = require("../helpers/getS3Url");
const { Op, json, literal } = require("sequelize");
// Si más adelante usarás S3
// const { uploadToS3 } = require("../middlewares/uploadImage");

/**
 * ✅ Crear un nuevo producto
 */
const createProduct = async (req, res) => {
  try {
    const { name, description, price, stock } = req.body;

    if (!name || !description || !price || !stock) {
      return res
        .status(400)
        .json({ message: "Todos los campos son requeridos" });
    }

    const slug = slugify(name, { lower: true, strict: true });

    const existingProduct = await Product.findOne({ where: { slug } });
    if (existingProduct) {
      return res.status(400).json({ message: "El producto ya existe" });
    }

    const newProduct = await Product.create({
      name,
      description,
      price,
      stock,
      slug,
    });

    if (req.file) {
      const imageUrl = await uploadToS3("products", req.file, newProduct.id);
      await ProductImage.create({ product_id: newProduct.id, url: imageUrl });
    }

    const productWithImage = await Product.findByPk(newProduct.id, {
      include: [{ model: ProductImage, as: "image" }],
    });

    res.status(201).json({
      message: "Producto creado correctamente",
      product: productWithImage,
    });
  } catch (error) {
    console.error("Error al crear producto:", error);
    res.status(500).json({ message: "Error al crear producto", error });
  }
};

/**
 * 📦 Obtener todos los productos
 */
const getAllProducts = async (req, res) => {
  try {
    // 📦 Paginación
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // 🔍 Búsqueda opcional
    const search = req.query.search?.trim() || "";

    // 🧠 Filtro dinámico
    const whereClause = search
      ? {
          [Op.or]: [
            { name: { [Op.like]: `%${search}%` } },
            { description: { [Op.like]: `%${search}%` } },
          ],
        }
      : {};

    // 🧭 Consulta paginada
    const { count, rows: products } = await Product.findAndCountAll({
      where: whereClause,
      include: [{ model: ProductImage, as: "image" }],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    // 🖼️ Obtener URL pública de la imagen (S3)
    const productsWithImageUrl = await Promise.all(
      products.map(async (product) => {
        let imageUrl = null;

        if (product.image?.url) {
          imageUrl = await getS3Url(product.image.url);
        }

        return {
          ...product.toJSON(),
          image: imageUrl ? { ...product.image.toJSON(), url: imageUrl } : null,
        };
      })
    );

    // 📄 Respuesta con metadata
    res.status(200).json({
      totalItems: count,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
      limit,
      products: productsWithImageUrl,
    });
  } catch (error) {
    console.error("❌ Error al obtener productos:", error);
    res.status(500).json({ message: "Error al obtener productos" });
  }
};
/**
 * 🔍 Obtener un producto por su slug o ID
 */
const getOneProduct = async (req, res) => {
  try {
    const { slugOrId } = req.params;

    const product = await Product.findOne({
      where: isNaN(slugOrId) ? { slug: slugOrId } : { id: slugOrId },
      include: [{ model: ProductImage, as: "image" }],
    });

    if (!product)
      return res.status(404).json({ message: "Producto no encontrado" });

    const baseSlug = product.slug.split("-").slice(0, -1).join("-");

    // 🔹 Producto principal
    const formatedProduct = {
      ...product.toJSON(),
      image: product.image?.url ? getS3Url(product.image.url) : null,
    };

    // 🔹 Productos relacionados
    const relatedProducts = await Product.findAll({
      where: {
        id: { [Op.ne]: product.id },
        slug: {
          [Op.like]: `${baseSlug}%`,
        },
        active: true,
      },
      limit: 6,
      include: [{ model: ProductImage, as: "image" }],
    });

    const formattedRelated = relatedProducts.map((p) => ({
      ...p.toJSON(),
      image: p.image?.url ? getS3Url(p.image.url) : null,
    }));

    res.json({
      product: formatedProduct,
      related: formattedRelated,
    });
  } catch (error) {
    console.error("Error al obtener producto:", error);
    res.status(500).json({ message: "Error al obtener producto" });
  }
};

/**
 * ✏️ Actualizar producto
 */
const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, stock, active } = req.body;

    const product = await Product.findByPk(id);
    if (!product)
      return res.status(404).json({ message: "Producto no encontrado" });

    const slug = name
      ? slugify(name, { lower: true, strict: true })
      : product.slug;

    await product.update({
      name: name ?? product.name,
      description: description ?? product.description,
      price: price ?? product.price,
      stock: stock ?? product.stock,
      slug,
      active: active ?? product.active,
    });

    // 🔹 Actualizar imagen si se envía una nueva
    const productImage = req.file;
    if (productImage) {
      // const imageUrl = await uploadToS3(req.file);
      const imageUrl = await uploadToS3("products", productImage, id);

      const existingImage = await ProductImage.findOne({
        where: { product_id: id },
      });
      if (existingImage) {
        await existingImage.update({ url: imageUrl });
      } else {
        await ProductImage.create({ product_id: id, url: imageUrl });
      }
    }

    const updated = await Product.findByPk(id, {
      include: [{ model: ProductImage, as: "image" }],
    });

    const formatedUpdate = {
      ...updated.toJSON(),
      image: updated.image.url ? getS3Url(updated.image.url) : null,
    };

    res.json({
      message: "Producto actualizado correctamente",
      product: formatedUpdate,
    });
  } catch (error) {
    console.error("Error al actualizar producto:", error);
    res.status(500).json({ message: "Error al actualizar producto" });
  }
};

/**
 * 🗑️ Eliminar un producto
 */
const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findByPk(id);

    if (!product)
      return res.status(404).json({ message: "Producto no encontrado" });

    await ProductImage.destroy({ where: { product_id: id } });
    await product.destroy();

    res.json({ message: "Producto eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar producto:", error);
    res.status(500).json({ message: "Error al eliminar producto" });
  }
};

module.exports = {
  createProduct,
  getAllProducts,
  getOneProduct,
  updateProduct,
  deleteProduct,
};
