import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.status(200).json({
    service: "api-gateway",
    status: "ok",
  });
});

router.post("/authorize", authenticate, (req, res, next) => {
  const permission = req.body?.permission;

  if (!permission || typeof permission !== "string") {
    return res.status(400).json({error: "Permission is required"});
  }

  authorize(permission)(req, res, next);
},
(req, res) => {
  res.status(200).json({
    allowed: true,
    user_id: req.user!.id,
    role: req.user!.role,
  })
});

export default router;