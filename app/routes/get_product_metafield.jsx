import { json } from '@remix-run/node';

async function getProductMetafields(productId) {
  const query = `
    query getProductMetafields($productId: ID!) {
      product(id: $productId) {
        id
        metafields(first: 100) {
          edges {
            node {
              id
              namespace
              key
              value
            }
          }
        }
      }
    }
  `;

  const response = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN,
    },
    body: JSON.stringify({
      query,
      variables: { productId: `gid://shopify/Product/${productId}` },
    }),
  });

  const result = await response.json();

  if (result.errors) {
    throw new Error(`Error fetching metafields: ${result.errors.map((err) => err.message).join(', ')}`);
  }

  const metafields = result.data.product.metafields.edges.map((edge) => edge.node);
  return metafields;
}

async function getMediaUrl(mediaId) {
  const query = `
    query getMedia($mediaId: ID!) {
      node(id: $mediaId) {
        ... on MediaImage {
          image {
            src
          }
        }
      }
    }
  `;

  const response = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_TOKEN,
    },
    body: JSON.stringify({
      query,
      variables: { mediaId },
    }),
  });

  const result = await response.json();

  if (result.errors) {
    throw new Error(`Error fetching media: ${result.errors.map((err) => err.message).join(', ')}`);
  }

  // Return the image URL from the response
  return result.data.node?.image?.src;
}

async function getMetafieldImageUrls(metafields) {
  const metafieldImageUrls = [];

  for (let metafield of metafields) {
    if (metafield.value) {
      try {
        // Only parse the value if it's an array (in JSON format)
        let mediaIds = [];
        
        if (metafield.key === 'custom_image' || metafield.key === 'builder_images') {
          // Try parsing the value as JSON
          try {
            mediaIds = JSON.parse(metafield.value);
          } catch (e) {
            // If parsing fails, treat the value as a single string
            mediaIds = [metafield.value];
          }

          // Handle both single and array of media IDs
          const imageUrls = await Promise.all(
            mediaIds.map(async (mediaId) => {
              const imageUrl = await getMediaUrl(mediaId);
              return imageUrl;
            })
          );

          metafieldImageUrls.push({
            metafieldKey: metafield.key,
            imageUrls,
          });
        }
      } catch (error) {
        console.error(`Error processing metafield ${metafield.key}:`, error);
      }
    }
  }

  return metafieldImageUrls;
}

// Handler function to get metafields and resolve image URLs
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const productId = url.searchParams.get('productId');

  if (!productId) {
    return json({ success: false, error: 'Product ID is required.' });
  }

  try {
    const metafields = await getProductMetafields(productId);
    console.log("metafields====>", metafields);
    const imageUrls = await getMetafieldImageUrls(metafields);
    console.log("imageUrls====>", imageUrls);

    return json({ success: true, imageUrls });
  } catch (error) {
    console.error('Error fetching metafields:', error);
    return json({ success: false, error: error.message });
  }
};
