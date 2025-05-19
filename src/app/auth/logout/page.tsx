'use client'

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    const performLogout = async () => {
      try {
        await authClient.signOut({
          fetchOptions: {
            onSuccess: () => {
              router.push('/');
            },
            onError: (error) => {
              // Handle any errors during sign out, e.g., show a message
              console.error('Logout failed:', error);
              // Optionally redirect to home or an error page even if logout fails
              router.push('/'); 
            }
          }
        });
      } catch (error) {
        console.error('Error during logout process:', error);
        // Fallback redirect if the signOut call itself throws an error
        router.push('/');
      }
    };

    performLogout().catch(error => {
      // Catch any errors from performLogout itself, though inner errors are handled
      console.error('Outer error during logout initiation:', error);
      router.push('/'); // Ensure redirection even in this case
    });
  }, [router]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <p>Logging out...</p>
    </div>
  );
}