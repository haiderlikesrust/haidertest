function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.redirect("/login");
  }
  return next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.session?.user) {
      return res.redirect("/login");
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render("error", {
        title: "Forbidden",
        message: "You do not have permission for this action.",
      });
    }
    return next();
  };
}

function canEdit(user) {
  return user && (user.role === "admin" || user.role === "editor");
}

module.exports = {
  requireAuth,
  requireRole,
  canEdit,
};
