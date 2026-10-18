const rolePermissions: Record<string, string[]> = {
  USER: [
    "client:access",
  ],

  ADMIN: [
    "admin:access","client:access"
  ],
};

export function hasPermission(role: string, permission: string): boolean {
  const normalizeRole = role.toUpperCase();
  const permissions = rolePermissions[normalizeRole];

  if (!permissions) {
    return false;
  }

  return permissions.includes(permission);
}