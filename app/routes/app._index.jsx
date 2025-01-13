import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  Box,
  Tabs,
  TextField,
  Spinner,
  IndexTable,
  Button,
  Modal,
  TextContainer,
  Pagination,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const formData = new URLSearchParams(await request.text());
  const queryValue = formData.get("queryValue") || "";
  const after = formData.get("after") || null;
  const productId = formData.get("productId");
  const actionType = formData.get("actionType");
  const collectionId = "gid://shopify/Collection/493361496383"; // Added collection ID for filtering products by collection
  
  const { admin } = await authenticate.admin(request);
  
  // Handle product actions: addPending, removePending, removeProduct
  if (actionType && productId) {
    try {
      if (actionType === "addPending") {
        await admin.graphql(
          `#graphql
          mutation addTag($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) {
              userErrors {
                message
              }
            }
          }`,
          {
            variables: {
              id: productId,
              tags: ["pending"],
            },
          }
        );
        return { success: true, updatedProductId: productId };
      } else if (actionType === "removePending") {
        await admin.graphql(
          `#graphql
          mutation removeTag($id: ID!, $tags: [String!]!) {
            tagsRemove(id: $id, tags: $tags) {
              userErrors {
                message
              }
            }
          }`,
          {
            variables: {
              id: productId,
              tags: ["pending"],
            },
          }
        );
        return { success: true, updatedProductId: productId };
      } else if (actionType === "removeProduct") {
        await admin.graphql(
          `#graphql
          mutation deleteProduct($id: ID!) {
            productDelete(input: { id: $id }) {
              deletedProductId
              userErrors {
                message
              }
            }
          }`,
          {
            variables: {
              id: productId,
            },
          }
        );
        return { success: true, deletedProductId: productId };
      }
  
      return { error: "Unknown action." };
    } catch (error) {
      return { error: "An error occurred while processing the request." };
    }
  }
  
  // Fetch products for a collection with pagination
  const products = [];
  let hasNextPage = true;
  let cursor = after;
  
  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
      query getCollectionProducts($collectionId: ID!, $first: Int!, $after: String) {
        collection(id: $collectionId) {
          products(first: $first, after: $after) {
            edges {
              node {
                id
                title
                tags
                handle
                featuredImage {
                  url
                }
              }
              cursor
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }`,
      {
        variables: {
          collectionId,
          first: 250,
          after: cursor,
        },
      }
    );
  
    const data = await response.json();
  
    if (data.data.collection) {
      const collectionProducts = data.data.collection.products.edges.map(
        (edge) => edge.node
      );
      products.push(...collectionProducts);
  
      hasNextPage = data.data.collection.products.pageInfo.hasNextPage;
      cursor = data.data.collection.products.pageInfo.endCursor;
    } else {
      hasNextPage = false;
    }
  }
  
  const pageInfo = "";
  
  return { products, pageInfo };
};

export default function Index() {
  const fetcher = useFetcher();
  const [products, setProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [selectedTab, setSelectedTab] = useState(0);
  const [queryValue, setQueryValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [endCursor, setEndCursor] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  const tabs = [
    { id: "all", content: "All" },
    { id: "active", content: "Activated Products" },
    { id: "inactive", content: "Inactive Products" },
  ];

  const filterProducts = (selectedTab, query) => {
    let filtered = [];

    switch (selectedTab) {
      case 1:
        filtered = products.filter(
          (product) =>
            product.tags.some((tag) => tag.startsWith("email_")) &&
            !product.tags.includes("pending")
        );
        setCurrentPage(1);
        break;

      case 2:
        filtered = products.filter(
          (product) =>
            product.tags.some((tag) => tag.startsWith("email_")) &&
            product.tags.includes("pending")
        );
        setCurrentPage(1);
        break;

      default:
        filtered = products.filter((product) =>
          product.tags.some((tag) => tag.startsWith("email_"))
        );
        setCurrentPage(1);
        break;
    }

    if (query) {
      filtered = filtered.filter((product) => {
        // Search in product title
        const titleMatch = product.title.toLowerCase().includes(query.toLowerCase());
        
        // Search in email tags (tags start with "email_")
        const emailMatch = product.tags.some((tag) =>
          tag.startsWith("email_") && tag.toLowerCase().includes(query.toLowerCase())
        );
  
        return titleMatch || emailMatch;
      });
      setCurrentPage(1);
    }

    setFilteredProducts(filtered);
  };

  const handleTabChange = (index) => {
    setSelectedTab(index);
    filterProducts(index, queryValue);
  };

  const handleQueryChange = (value) => {
    setQueryValue(value);
    filterProducts(selectedTab, value);
  };

  const handleQueryClear = () => {
    setQueryValue("");
    filterProducts(selectedTab, "");
  };

  const fetchProducts = async (after = null) => {
    setLoading(true);

    const formData = new FormData();
    formData.append("queryValue", queryValue);
    if (after) {
      formData.append("after", after);
    }

    fetcher.submit(formData, { method: "post" });
  };

  const handleAction = (productId, actionType) => {
    setPendingAction({ productId, actionType });
    setShowModal(true);
  };

  const confirmAction = () => {
    if (pendingAction) {
      const { productId, actionType } = pendingAction;
      const formData = new FormData();
      formData.append("productId", productId);
      formData.append("actionType", actionType);
      fetcher.submit(formData, { method: "post" });
    }
    setShowModal(false);
    setPendingAction(null);
  };

  const cancelAction = () => {
    setShowModal(false);
    setPendingAction(null);
  };

  useEffect(() => {
    if (fetcher.data) {
      if (fetcher.data.products) {
        setProducts((prev) => [...prev, ...fetcher.data.products]);
        setHasNextPage(fetcher.data.pageInfo?.hasNextPage);
        setEndCursor(fetcher.data.pageInfo?.endCursor);
        setLoading(false);
      } else if (fetcher.data.success) {
        const updatedProductId = fetcher.data.updatedProductId;
        setProducts((prev) =>
          prev.map((product) =>
            product.id === updatedProductId
              ? {
                  ...product,
                  tags: fetcher.data.deletedProductId
                    ? [] // In case of product deletion, clear tags
                    : product.tags.includes("pending")
                    ? product.tags.filter((tag) => tag !== "pending")
                    : [...product.tags, "pending"],
                }
              : product
          )
        );
        setLoading(false);
  
        // If a product was deleted, remove it from the products list
        if (fetcher.data.deletedProductId) {
          setProducts((prev) =>
            prev.filter((product) => product.id !== fetcher.data.deletedProductId)
          );
        }
      } else if (fetcher.data.error) {
        console.error(fetcher.data.error);
        setLoading(false);
      }
    }
  }, [fetcher.data]);

  useEffect(() => {
    filterProducts(selectedTab, queryValue);
  }, [products, selectedTab, queryValue]);

  useEffect(() => {
    fetchProducts();
  }, []);

  const resourceName = {
    singular: "product",
    plural: "products",
  };

  // Paginate filtered products to display 25 products per page
  const paginatedProducts = filteredProducts.slice(
    (currentPage - 1) * 25,
    currentPage * 25
  );

  const rowMarkup = paginatedProducts.map(
    ({ id, title, tags, handle, featuredImage }, index) => {
      const numericProductId = id.split("/").pop();

      const emailTags = tags
        .filter((tag) => tag.startsWith("email_"))
        .map((tag) => tag.replace("email_", ""));

      const isPending = tags.includes("pending");

      return (
        <IndexTable.Row id={id} key={id} position={index}>
          <IndexTable.Cell>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {featuredImage ? (
                <img
                  src={featuredImage.url}
                  alt={`${title} image`}
                  style={{
                    width: "40px",
                    height: "40px",
                    objectFit: "cover",
                    borderRadius: "4px",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    backgroundColor: "#f0f0f0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "4px",
                  }}
                >
                  No Image
                </div>
              )}
              <a
                href={`https://admin.shopify.com/store/ad7dbd-2/products/${numericProductId}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "underline", color: "blue" }}
              >
                {title}
              </a>
            </div>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <div style={{ wordWrap: "break-word", whiteSpace: "normal" }}>
              {emailTags.join(", ")}
            </div>
          </IndexTable.Cell>
          <IndexTable.Cell>
            {isPending ? (
              <Button onClick={() => handleAction(id, "removePending")}>
                Activate
              </Button>
            ) : (
              <Button onClick={() => handleAction(id, "addPending")}>
                Inactivate
              </Button>
            )}
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Button onClick={() => handleAction(id, "removeProduct")}>
              Remove
            </Button>
          </IndexTable.Cell>
        </IndexTable.Row>
      );
    }
  );

  return (
    <Page title="User Custom Products">
      <Card>
        <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange} />
        <Box>
          <TextField
            label="Search Template"
            value={queryValue}
            onChange={handleQueryChange}
            clearButton
            onClearButtonClick={handleQueryClear}
            autoComplete="off"
          />
        </Box>

        {loading && products.length === 0 ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "100px" }}>
            <Spinner accessibilityLabel="Loading products" size="large" />
          </div>
        ) : (
          <>
            <IndexTable
              resourceName={resourceName}
              itemCount={filteredProducts.length}
              headings={[
                { title: "Title" },
                { title: "Customer Email" },
                { title: "Action" },
                { title: "Remove Product" },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
            
            {/* Polaris Pagination Controls */}
            {filteredProducts.length > 25 && (
              <div style={{ display: "flex", justifyContent: "center", marginTop: "20px" }}>
                <Pagination
                  hasPrevious={currentPage > 1}
                  hasNext={currentPage * 25 < filteredProducts.length}
                  onPrevious={() => setCurrentPage(currentPage - 1)}
                  onNext={() => setCurrentPage(currentPage + 1)}
                  label={`Page ${currentPage} of ${Math.ceil(filteredProducts.length / 25)}`}
                />
              </div>
            )}
          </>
        )}
      </Card>

      {showModal && (
        <Modal
          open={showModal}
          onClose={cancelAction}
          title="Confirm Action"
          primaryAction={{
            content: "Yes",
            onAction: confirmAction,
          }}
          secondaryAction={{
            content: "No",
            onAction: cancelAction,
          }}
        >
          <Modal.Section>
            <TextContainer>
              <p>Are you sure you want to proceed with this action?</p>
            </TextContainer>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
