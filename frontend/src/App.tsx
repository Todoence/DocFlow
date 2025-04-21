// frontend/src/App.tsx
import React, { useState, useEffect } from "react";
import {
  Layout,
  Tabs,
  Upload,
  Button,
  message,
  Table,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Spin,
  Popconfirm,
} from "antd";
import { InboxOutlined } from "@ant-design/icons";
import axios from "axios";

const { Header, Content } = Layout;
const { TabPane } = Tabs;
const { Option } = Select;

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL,
});

type LineItem = {
  "Request Item": string;
  Quantity: number;
  "Unit Price": number;
  "Total Amount": number;
};

export default function App() {
  const [activeTab, setActiveTab] = useState<"upload" | "extract" | "match">(
    "upload"
  );
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [matches, setMatches] = useState<string[][]>([]);
  const [selectedMatches, setSelectedMatches] = useState<string[]>([]);
  const [searchOptions, setSearchOptions] = useState<Record<number, string[]>>(
    {}
  );

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    const draft = localStorage.getItem("orderDraft");
    if (draft) {
      setLineItems(JSON.parse(draft));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("orderDraft", JSON.stringify(lineItems));
  }, [lineItems]);

  const handleFileSelect = (f: File) => {
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    message.success(`${f.name} selected.`);
    return false;
  };

  const handleExtract = async () => {
    if (!file) {
      message.error("Please upload a PDF first.");
      return;
    }
    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const resp = await api.post<LineItem[]>("/extract", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setLineItems(resp.data);
      message.success("Extraction complete.");
      setActiveTab("extract");
    } catch {
      message.error("Extraction failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleProceedToMatch = async () => {
    try {
      await api.post("/save-draft", {
        order_id: "current_order",
        items: lineItems,
      });
      const queries = lineItems.map((it) => it["Request Item"]);
      const resp = await api.post<{
        results: Record<string, { match: string; score: number }[]>;
      }>("/match", { queries });
      const allMatches = queries.map((q) =>
        resp.data.results[q]?.map((r) => r.match) || []
      );
      setMatches(allMatches);
      setSelectedMatches(allMatches.map((arr) => arr[0] || ""));
      setSearchOptions({});
      message.success("Matches loaded.");
      setActiveTab("match");
    } catch {
      message.error("Failed to load matches.");
    }
  };

  const handleExportCSV = async () => {
    try {
      await api.post("/save-final", {
        order_id: "current_order",
        items: lineItems.map((item, idx) => ({
          "Request Item": item["Request Item"],
          "Match Item": selectedMatches[idx] || "",
          Quantity: item.Quantity,
          "Unit Price": item["Unit Price"],
          "Total Amount": item["Total Amount"],
        })),
      });
      message.success("Final data saved.");
    } catch {
      message.error("Save to server failed, export aborted.");
      return;
    }
    const headers = [
      "Request Item",
      "Match Item",
      "Quantity",
      "Unit Price",
      "Total Amount",
    ];
    const rows = lineItems.map((item, idx) => [
      `"${item["Request Item"].replace(/"/g, '""')}"`,
      `"${(selectedMatches[idx] || "").replace(/"/g, '""')}"`,
      item.Quantity,
      item["Unit Price"],
      item["Total Amount"],
    ]);
    const csvContent =
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "order_export.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const openEditModal = (record: LineItem, idx: number) => {
    setEditingIndex(idx);
    form.setFieldsValue(record);
  };

  const saveEdit = async () => {
    const values = await form.validateFields();
    if (editingIndex === null) return;
    const updated = [...lineItems];
    updated[editingIndex] = {
      "Request Item": values["Request Item"],
      Quantity: values.Quantity,
      "Unit Price": values["Unit Price"],
      "Total Amount": values["Total Amount"],
    };
    setLineItems(updated);
    setEditingIndex(null);
    message.success("Draft updated.");
  };

  const handleDelete = (idx: number) => {
    const updated = [...lineItems];
    updated.splice(idx, 1);
    setLineItems(updated);
    setMatches((m) => {
      const c = [...m];
      c.splice(idx, 1);
      return c;
    });
    setSelectedMatches((s) => {
      const c = [...s];
      c.splice(idx, 1);
      return c;
    });
    setSearchOptions((so) => {
      const c: Record<number, string[]> = {};
      Object.entries(so).forEach(([key, val]) => {
        const k = Number(key);
        if (k < idx) c[k] = val;
        else if (k > idx) c[k - 1] = val;
      });
      return c;
    });
  };

  const extractColumns = [
    { title: "Item", dataIndex: "Request Item", key: "item" },
    { title: "Quantity", dataIndex: "Quantity", key: "qty" },
    { title: "Unit Price", dataIndex: "Unit Price", key: "unitPrice" },
    { title: "Total Amount", dataIndex: "Total Amount", key: "totalAmount" },
    {
      title: "Actions",
      key: "actions",
      render: (_: any, record: LineItem, idx: number) => (
        <>
          <Button type="link" onClick={() => openEditModal(record, idx)}>
            Edit
          </Button>
          <Popconfirm
            title="Delete this line?"
            onConfirm={() => handleDelete(idx)}
          >
            <Button type="link" danger>
              Delete
            </Button>
          </Popconfirm>
        </>
      ),
    },
  ];

  // destructure first four data cols
  const [itemCol, qtyCol, unitCol, totalCol] = extractColumns;

  const matchCol = {
    title: "Match Item",
    dataIndex: "matchItem",
    key: "matchItem",
    render: (_: any, __: any, rowIndex: number) => (
      <Select
        showSearch
        filterOption={false}
        placeholder="Select or search…"
        style={{ width: 240, background: "#e6f7ff" }}
        value={selectedMatches[rowIndex]}
        onChange={(value) => {
          const sel = [...selectedMatches];
          sel[rowIndex] = value;
          setSelectedMatches(sel);
        }}
        onSearch={async (text) => {
          if (!text) return;
          try {
            const res = await api.get<{ results: string[] }>(
              "/catalog/search",
              { params: { q: text, limit: 10 } }
            );
            setSearchOptions((prev) => ({
              ...prev,
              [rowIndex]: res.data.results,
            }));
          } catch {
            // ignore
          }
        }}
      >
        {matches[rowIndex]?.map((m, i) => (
          <Option key={`m${i}`} value={m}>
            {m}
          </Option>
        ))}
        {searchOptions[rowIndex]?.map((m, i) => (
          <Option key={`s${i}`} value={m}>
            {m}
          </Option>
        ))}
      </Select>
    ),
  };

  const actionsCol = extractColumns[4];

  const matchColumns = [
    itemCol,
    matchCol,
    qtyCol,
    unitCol,
    totalCol,
    actionsCol,
  ];

  return (
    <Layout style={{ height: "100vh" }}>
      <Header style={{ color: "#fff", fontSize: 16 }}>Process Order</Header>
      <Content style={{ display: "flex", padding: 16, gap: 16 }}>
        <div style={{ flex: 1, border: "1px solid #ddd" }}>
          {previewUrl && (
            <object
              width="100%"
              height="100%"
              type="application/pdf"
              data={previewUrl}
            />
          )}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <Tabs activeKey={activeTab} onChange={(k) => setActiveTab(k as any)}>
            <TabPane tab="Upload" key="upload">
              <Upload.Dragger
                name="file"
                multiple={false}
                accept=".pdf"
                showUploadList={false}
                beforeUpload={handleFileSelect}
                style={{ padding: 40 }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p>Drag PDF here or click to upload</p>
              </Upload.Dragger>
              {file && <p>Uploaded: {file.name}</p>}
              <div style={{ marginTop: 16 }}>
                <Button onClick={() => setFile(null)}>Clear</Button>
                <Button
                  type="primary"
                  onClick={handleExtract}
                  style={{ marginLeft: 8 }}
                >
                  Confirm
                </Button>
              </div>
            </TabPane>

            <TabPane tab="Extract" key="extract">
              {loading ? (
                <Spin />
              ) : (
                <>
                  <Table
                    dataSource={lineItems}
                    columns={extractColumns}
                    rowKey={(_, idx = 0) => idx.toString()}
                    pagination={false}
                    style={{ marginBottom: 16 }}
                  />
                  <Button type="primary" onClick={handleProceedToMatch}>
                    Proceed to Match
                  </Button>
                </>
              )}
            </TabPane>

            <TabPane tab="Match" key="match">
              <Table
                dataSource={lineItems}
                columns={matchColumns}
                rowKey={(_, idx = 0) => idx.toString()}
                pagination={false}
              />
              <Button
                type="primary"
                style={{ marginTop: 16 }}
                onClick={handleExportCSV}
              >
                Save and Export
              </Button>
            </TabPane>
          </Tabs>
        </div>
        <Modal
          title="Edit Line Item"
          open={editingIndex !== null}
          onCancel={() => setEditingIndex(null)}
          onOk={saveEdit}
        >
          <Form form={form} layout="vertical">
            <Form.Item
              name="Request Item"
              label="Item"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="Quantity"
              label="Quantity"
              rules={[{ required: true }]}
            >
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="Unit Price"
              label="Unit Price"
              rules={[{ required: true }]}
            >
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="Total Amount"
              label="Total Amount"
              rules={[{ required: true }]}
            >
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
          </Form>
        </Modal>
      </Content>
    </Layout>
  );
}
