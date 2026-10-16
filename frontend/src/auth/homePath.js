// Where a logged-in user lands. Role-based pages come later (driver, admin);
// for now everyone goes to "/".
export function homePathFor(role) {
  switch (role) {
    default:
      return '/'
  }
}
