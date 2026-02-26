import { body, validationResult } from "express-validator";
import { Request, Response, NextFunction } from "express";

/**
 * Input validation rules and middleware
 */

// Validation middleware for /api/recipe
export const validateRecipeRequest = [
  body("prompt")
    .isString()
    .withMessage("Prompt must be a string")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Prompt must be between 1 and 500 characters"),
];

// Validation middleware for /api/image
export const validateImageRequest = [
  body("recipeName")
    .isString()
    .withMessage("Recipe name must be a string")
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Recipe name must be between 1 and 100 characters"),
  body("keywords")
    .isArray({ min: 1, max: 10 })
    .withMessage("Keywords must be an array with 1-10 items"),
  body("keywords.*")
    .isString()
    .withMessage("Each keyword must be a string")
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage("Each keyword must be between 1 and 50 characters"),
];

/**
 * Middleware to handle validation errors
 */
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Invalid request",
      details: errors.array().map((err) => ({
        field: err.type === "field" ? err.path : "unknown",
        message: err.msg,
      })),
    });
  }
  next();
};
