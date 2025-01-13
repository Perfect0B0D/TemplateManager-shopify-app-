import { json } from "@remix-run/node";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// AWS S3 Configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION, // Your AWS region
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function uploadImageToS3(bucketName, fileName, fileBuffer) {
  try {
    // Set up the S3 upload parameters
    const uploadParams = {
      Bucket: bucketName,
      Key: fileName, // File name in S3
      Body: fileBuffer,
      ContentType: 'image/jpeg', // Set the correct MIME type
      ACL: 'public-read',
    };

    // Upload the file to S3 using the PutObjectCommand
    const command = new PutObjectCommand(uploadParams);
    const data = await s3Client.send(command);
    console.log(`File uploaded successfully. S3 URL: https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`);
    return `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

// Helper: Check if product exists by title
async function checkIfProductExists(productTitle) {
  const query = `
    query {
      products(first: 1, query: "title:${productTitle}") {
        edges {
          node {
            id
            title
          }
        }
      }
    }
  `;

  const response = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_TOKEN,
      },
      body: JSON.stringify({ query }),
    }
  );

  const result = await response.json();
  const products = result.data.products.edges;

  // If the product exists, return its ID, else return null or an appropriate message
  if (products.length > 0) {
    return {
      exists: true,
      productId: products[0].node.id, // Returning the product ID
    };
  } else {
    return {
      exists: false,
      productId: null, // No product found
    };
  }
}


// Helper: Delete product by ID
async function removeProduct(productId) {
  const deleteProductQuery = `
    mutation DeleteProduct($input: ProductDeleteInput!) {
      productDelete(input: $input) {
        deletedProductId
        userErrors {
          field
          message
        }
      }
    }
  `;

  // Ensure the productId is in the global ID format
  const globalProductId = `gid://shopify/Product/${productId}`;

  const response = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_TOKEN,
      },
      body: JSON.stringify({
        query: deleteProductQuery,
        variables: { input: { id: globalProductId } },
      }),
    },
  );

  const result = await response.json();
  if (result.errors || result.data?.productDelete?.userErrors?.length) {
    const errors = result.errors || result.data.productDelete.userErrors;
    throw new Error(
      errors.map((err) => `${err.field || "Error"}: ${err.message}`).join(", "),
    );
  }

  return result.data.productDelete.deletedProductId;
}

// Helper: Edit product details
// Helper: Edit product details
async function editProduct(productId, productTitle, imageUrls) {
  const globalProductId = `gid://shopify/Product/${productId}`; // Convert to global ID format

  // Update the product's title (without media)
  const updateProductQuery = `
    mutation UpdateProduct($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          title
          tags
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const updatedProductInput = {
    id: globalProductId,
    title: productTitle,
  };

  const response = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_TOKEN,
      },
      body: JSON.stringify({
        query: updateProductQuery,
        variables: { input: updatedProductInput },
      }),
    }
  );

  const result = await response.json();
  if (result.errors || result.data?.productUpdate?.userErrors?.length) {
    const errors = result.errors || result.data.productUpdate.userErrors;
    throw new Error(
      errors.map((err) => `${err.field || "Error"}: ${err.message}`).join(", ")
    );
  }

  // Ensure 'pending' tag is added if not already present
  let tags = result.data.productUpdate.product.tags || [];
  if (!tags.includes('pending')) {
    tags.push('pending');
  }

  // Proceed to update product tags
  const updateTagsQuery = `
    mutation UpdateProductTags($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          tags
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const updateTagsInput = {
    id: globalProductId,
    tags: tags,
  };

  const updateTagsResponse = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_TOKEN,
      },
      body: JSON.stringify({
        query: updateTagsQuery,
        variables: { input: updateTagsInput },
      }),
    }
  );

  const updateTagsResult = await updateTagsResponse.json();
  if (updateTagsResult.errors || updateTagsResult.data?.productUpdate?.userErrors?.length) {
    const errors = updateTagsResult.errors || updateTagsResult.data.productUpdate.userErrors;
    throw new Error(
      errors.map((err) => `${err.field || "Error"}: ${err.message}`).join(", ")
    );
  }

  // Replace the product's media (delete old, then add new)
  if (imageUrls.length > 0) {
    // Step 1: Fetch existing media for the product
    const fetchMediaQuery = `
      query getProductMedia($id: ID!) {
        product(id: $id) {
          media(first: 100) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `;

    const fetchMediaResponse = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_TOKEN,
        },
        body: JSON.stringify({
          query: fetchMediaQuery,
          variables: { id: globalProductId },
        }),
      }
    );

    const fetchMediaResult = await fetchMediaResponse.json();
    const existingMediaIds =
      fetchMediaResult.data?.product?.media?.edges?.map((edge) => edge.node.id) || [];

    // Step 2: Delete existing media
    if (existingMediaIds.length > 0) {
      const deleteMediaQuery = `
        mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
          productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
            deletedMediaIds
            userErrors {
              field
              message
            }
          }
        }
      `;

      const deleteMediaResponse = await fetch(
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_TOKEN,
          },
          body: JSON.stringify({
            query: deleteMediaQuery,
            variables: {
              productId: globalProductId,
              mediaIds: existingMediaIds,
            },
          }),
        }
      );

      const deleteMediaResult = await deleteMediaResponse.json();

      if (
        deleteMediaResult.errors ||
        deleteMediaResult.data?.productDeleteMedia?.userErrors?.length
      ) {
        const deleteMediaErrors =
          deleteMediaResult.errors ||
          deleteMediaResult.data.productDeleteMedia.userErrors;
        throw new Error(
          deleteMediaErrors
            .map((err) => `${err.field || "Error"}: ${err.message}`)
            .join(", ")
        );
      }
    }

    // Step 3: Add new media
    const attachMediaQuery = `
      mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            mediaContentType
            alt
            preview {
              image {
                src
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const mediaInputs = imageUrls.map((url) => ({
      mediaContentType: "IMAGE",
      originalSource: url,
      alt: "Updated product image",
    }));

    const attachMediaResponse = await fetch(
      `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_TOKEN,
        },
        body: JSON.stringify({
          query: attachMediaQuery,
          variables: { productId: globalProductId, media: mediaInputs },
        }),
      }
    );

    const attachMediaResult = await attachMediaResponse.json();

    if (
      attachMediaResult.errors ||
      attachMediaResult.data?.productCreateMedia?.userErrors?.length
    ) {
      const attachMediaErrors =
        attachMediaResult.errors ||
        attachMediaResult.data.productCreateMedia.userErrors;
      throw new Error(
        attachMediaErrors
          .map((err) => `${err.field || "Error"}: ${err.message}`)
          .join(", ")
      );
    }
  }

  return result.data.productUpdate.product;
}
// Main Action Handler
export const action = async ({ request }) => {
  const formData = await request.formData();
  const actionType = formData.get("actionType"); // "create", "edit", or "remove"
  const productId = formData.get("productId"); // Required for "edit" and "remove"
  const productTitle = formData.get("productTitle");
  const productTag = formData.get("productTag");
  const updatedTags = [productTag, "pending", "Boxes", "customdesign"];
  const imageUrls = [];
  // Handle Product Removal
  if (actionType === "remove" && productId) {
    try {
      const deletedProductId = await removeProduct(productId);
      return json({
        success: true,
        message: `Product with ID ${deletedProductId} has been deleted.`,
      });
    } catch (error) {
      console.error("Error removing product:", error);
      return json({ success: false, error: error.message });
    }
  }

  // Handle Product Editing
  if (actionType === "edit" && productId) {
    const productCheckResult = await checkIfProductExists(productTitle);
    if (productCheckResult.exists && productCheckResult.productId.split("/").pop() != productId) {
      return json({
        success: false,
        error: "Product title already exists. Please use a different title.",
      });
    }
    for (let i = 1; i <= 3; i++) {
      const imageFile = formData.get(`image${i}`);
      if (imageFile instanceof File) { // Check if it's a file
          const fileName = `product_${Date.now()}_${i}.jpg`;
          const imagePathInBucket = `product-images/${fileName}`;
          const arrayBuffer = await imageFile.arrayBuffer();
          const imageBuffer = Buffer.from(arrayBuffer);
          const uploadedUrl = await uploadImageToS3(
              "greetabl-production",
              imagePathInBucket,
              imageBuffer,
          );

          if (uploadedUrl) {
              imageUrls.push(
                  `${uploadedUrl}`,
              );
          }
      } else if (typeof imageFile === "string" && imageFile.startsWith("http")) { // Check if it's a public URL
          imageUrls.push(imageFile);
      } else {
          console.log("No valid file or URL for image", i);
      }
  }
    try {
      const updatedProduct = await editProduct(
        productId,
        productTitle,
        imageUrls,
      );
      return json({
        success: true,
        product: updatedProduct,
        message: "The template has been successfully updated. Your template will be checked by our staff.",
      });
    } catch (error) {
      console.error("Error editing product:", error);
      return json({ success: false, error: error.message });
    }
  }

  // Handle Product Creation
  if (actionType === "create") {
    const productCheckResult = await checkIfProductExists(productTitle);
    if (productCheckResult.exists) {
      return json({
        success: false,
        error: "Product title already exists. Please use a different title.",
      });
    }

    for (let i = 1; i <= 3; i++) {
      const imageFile = formData.get(`image${i}`);
      if (imageFile) {
        const fileName = `product_${Date.now()}_${i + 1}.jpg`;
        const imagePathInBucket = `product-images/${fileName}`;
        const arrayBuffer = await imageFile.arrayBuffer();
        const imageBuffer = Buffer.from(arrayBuffer);
        const uploadedUrl = await uploadImageToS3(
          "greetabl-production",
          imagePathInBucket,
          imageBuffer,
      );

        if (uploadedUrl) {
          imageUrls.push(
            `${uploadedUrl}`,
          );
        }
      }
    }

    const createProductQuery = `
    mutation CreateProduct($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          title
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

    const productInput = {
      title: productTitle,
      tags: updatedTags,
      variants: [
        {
          price: "15.00",
          sku: "",
        },
      ],
    };

    try {
      const createResponse = await fetch(
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_TOKEN,
          },
          body: JSON.stringify({
            query: createProductQuery,
            variables: { input: productInput },
          }),
        },
      );

      const createResult = await createResponse.json();
      if (
        createResult.errors ||
        createResult.data?.productCreate?.userErrors?.length
      ) {
        const errors =
          createResult.errors || createResult.data.productCreate.userErrors;
        throw new Error(
          errors
            .map((err) => `${err.field || "Error"}: ${err.message}`)
            .join(", "),
        );
      }

      const productId = createResult.data.productCreate.product.id;

      // Step 4: Attach the images to the product
      const attachMediaQuery = `
    mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          mediaContentType
          alt
          preview {
            image {
              src
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

      const mediaInputs = imageUrls.map((url) => ({
        mediaContentType: "IMAGE",
        originalSource: url,
        alt: "Product image",
      }));

      const attachMediaResponse = await fetch(
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_TOKEN,
          },
          body: JSON.stringify({
            query: attachMediaQuery,
            variables: { productId, media: mediaInputs },
          }),
        },
      );

      const attachMediaResult = await attachMediaResponse.json();

      if (
        attachMediaResult.errors ||
        attachMediaResult.data?.productCreateMedia?.userErrors?.length
      ) {
        const attachMediaErrors =
          attachMediaResult.errors ||
          attachMediaResult.data.productCreateMedia.userErrors;
        throw new Error(
          attachMediaErrors
            .map((err) => `${err.field || "Error"}: ${err.message}`)
            .join(", "),
        );
      }

      const publishProductQuery = `
      mutation PublishProduct($input: ProductPublishInput!) {
        productPublish(input: $input) {
          product {
            id
            publishedAt
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

      const publishProductInput = {
        id: productId, // Root level product ID
        productPublications: [
          {
            publicationId: "gid://shopify/Publication/185577668927", // Replace with your actual publication ID
          },
        ],
      };

      const publishResponse = await fetch(
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_TOKEN,
          },
          body: JSON.stringify({
            query: publishProductQuery,
            variables: { input: publishProductInput },
          }),
        },
      );

      const publishResult = await publishResponse.json();
      if (
        publishResult.errors ||
        publishResult.data?.productPublish?.userErrors?.length
      ) {
        const publishErrors =
          publishResult.errors || publishResult.data.productPublish.userErrors;
        throw new Error(
          publishErrors
            .map((err) => `${err.field || "Error"}: ${err.message}`)
            .join(", "),
        );
      }

      return json({
        success: true,
        product: createResult.data.productCreate.product,
        publishedAt: publishResult.data.productPublish.product.publishedAt,
        message: "Your template has been successfully created. Your template will be checked by our staff."
      });
    } catch (error) {
      console.error("Error creating or publishing product:", error);
      return json({ success: false, error: error.message });
    }
  }

  return json({
    success: false,
    error: "Invalid action type or missing required fields.",
  });
};
