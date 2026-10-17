import { Link } from 'react-router-dom'
import AdminLayout from './AdminLayout.jsx'

export default function AdminHome() {
  return (
    <AdminLayout title="Admin">
      <ul className="admin-home">
        <li>
          <Link to="/admin/stops" className="admin-home__link">
            <span className="admin-home__title">Stops</span>
            <span className="admin-home__text">Add, edit and delete bus stops</span>
          </Link>
        </li>
        <li>
          <Link to="/admin/routes" className="admin-home__link">
            <span className="admin-home__title">Routes</span>
            <span className="admin-home__text">Add, edit and delete routes and their stop order</span>
          </Link>
        </li>
        <li>
          <Link to="/admin/fleet" className="admin-home__link">
            <span className="admin-home__title">Fleet</span>
            <span className="admin-home__text">See every bus: status, position, driver, route and last update</span>
          </Link>
        </li>
        <li>
          <Link to="/admin/analytics" className="admin-home__link">
            <span className="admin-home__title">Analytics</span>
            <span className="admin-home__text">Trips, ratings and delays per route, and trips by weekday and hour</span>
          </Link>
        </li>
      </ul>
    </AdminLayout>
  )
}
