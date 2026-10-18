import express from "express";
import authorizationRouter from "./routes/authorization.routes.js";

const app = express();

app.use(express.json());

app.use("/api", authorizationRouter);

export default app;