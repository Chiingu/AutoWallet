import type { Request, Response, NextFunction } from "express";
import { hasPermission } from "../services/authorization.service.js";

export function authorize(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: "Authentication required",
      });
    }

    const allowed = hasPermission(req.user.role, permission);

    if (!allowed) {
      return res.status(403).json({
        allowed: false,
        error: "Permission denied",
      });
    }
    next();
  };
}