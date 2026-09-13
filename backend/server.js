const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Data Sell Pro Backend is running"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "API is working"
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Data Sell Pro server running on port ${PORT}`);
});
