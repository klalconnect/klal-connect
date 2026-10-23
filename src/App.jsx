import { lazy } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import AutoUpdate from '@/components/AutoUpdate';
import ErrorBoundary from '@/components/ErrorBoundary';
import InstallPrompt from '@/components/InstallPrompt';
import AppLayout from '@/components/AppLayout';
import Home from '@/pages/Home';
import Browse from '@/pages/Browse';
import ProviderDetail from '@/pages/ProviderDetail';
import Saved from '@/pages/Saved';
import AddListing from '@/pages/AddListing';
import Profile from '@/pages/Profile';
import Settings from '@/pages/Settings';
// Split out of the first load: the admin screens are staff-only, and Jobs is
// not in the nav until there are jobs. Neither belongs in the bundle a first
// visitor downloads before seeing the directory.
const Admin = lazy(() => import('@/pages/Admin'));
import Feed from '@/pages/Feed';
import Directory from '@/pages/Directory';
import DirectoryCategory from '@/pages/DirectoryCategory';
import People from '@/pages/People';
import PublicProfile from '@/pages/PublicProfile';
import CreateCompany from '@/pages/CreateCompany';
import CompanyPage from '@/pages/CompanyPage';
import Companies from '@/pages/Companies';
const Jobs = lazy(() => import('@/pages/Jobs'));
const PostJob = lazy(() => import('@/pages/PostJob'));
const JobDetail = lazy(() => import('@/pages/JobDetail'));
import Messages from '@/pages/Messages';
import Conversation from '@/pages/Conversation';
import Login from '@/pages/Login';
import Join from '@/pages/Join';
import Privacy from '@/pages/Privacy';
import Terms from '@/pages/Terms';
import About from '@/pages/About';
import Contact from '@/pages/Contact';
import Welcome from '@/pages/Welcome';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

// /signup is what people type; the page lives at /register. The server
// redirects a fresh load, this covers a link followed inside the app. The
// query string rides along so returnTo and reason survive.
const SignupRedirect = () => { const { search } = useLocation(); return <Navigate to={`/register${search}`} replace />; };

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <span aria-hidden="true" className="kc-spinner" style={{ width: 36, height: 36, borderWidth: 3 }}></span>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/feed" element={<Feed />} />
        <Route path="/directory" element={<Directory />} />
        <Route path="/directory/:category" element={<DirectoryCategory />} />
        <Route path="/directory/:category/:city" element={<DirectoryCategory />} />
        <Route path="/people" element={<People />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/messages/:id" element={<Conversation />} />
        <Route path="/profile/:id" element={<PublicProfile />} />
        <Route path="/companies" element={<Companies />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route path="/post-job" element={<PostJob />} />
        <Route path="/company/:slug" element={<CompanyPage />} />
        <Route path="/create-company" element={<CreateCompany />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/provider/:slug" element={<ProviderDetail />} />
        <Route path="/gemach/:slug" element={<ProviderDetail />} />
        <Route path="/saved" element={<Saved />} />
        <Route path="/add" element={<AddListing />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="/login" element={<Login />} />
      <Route path="/join/:code" element={<Join />} />
      <Route path="/register" element={<Register />} />
      <Route path="/signup" element={<SignupRedirect />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          {/* Inside the Router so the recovery screen keeps the header and
              the person can navigate away instead of staring at a blank page. */}
          <ErrorBoundary>
            <AuthenticatedApp />
          </ErrorBoundary>
          {/* Applies a new build on its own; it needs the route to know when
              a reload cannot cost anyone their words. */}
          <AutoUpdate />
          {/* Inside the Router: the install prompt has to know which route is
              showing, because it must never cover a sign-up form. */}
          <InstallPrompt />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App