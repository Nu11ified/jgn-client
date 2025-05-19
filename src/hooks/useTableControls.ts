import { useState, useMemo, useCallback } from 'react';

interface UseTableControlsProps<T> {
  data: T[] | null | undefined;
  searchKeys: (keyof T)[];
  initialSearchTerm?: string;
  // initialItemsPerPage is no longer used by this version of the hook directly
}

export function useTableControls<T>({
  data,
  searchKeys,
  initialSearchTerm = '',
}: UseTableControlsProps<T>) {
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm);
  // Pagination state is removed as virtualization handles display of large lists

  const filteredData = useMemo(() => {
    if (!data) return []; // Return empty array if no data
    if (!searchTerm) return data;

    const lowercasedSearchTerm = searchTerm.toLowerCase();
    return data.filter((item) =>
      searchKeys.some((key) => {
        const value = item[key];
        if (typeof value === 'string' || typeof value === 'number') {
          return String(value).toLowerCase().includes(lowercasedSearchTerm);
        }
        return false;
      })
    );
  }, [data, searchTerm, searchKeys]);

  const totalItems = filteredData.length;
  // totalPages is no longer calculated here as pagination is not handled by this hook for virtualization

  // paginatedData is removed, the full filteredData is returned

  const handleSearchChange = useCallback((term: string) => {
    setSearchTerm(term);
    // setCurrentPage(1); // No longer resetting page as pagination is removed
  }, []);

  // handleItemsPerPageChange is removed
  
  // currentPage boundary checks are removed

  return {
    // paginatedData, // Removed
    filteredData, // Added
    searchTerm,
    setSearchTerm: handleSearchChange,
    // currentPage, // Removed
    // setCurrentPage, // Removed
    // itemsPerPage, // Removed
    // setItemsPerPage: handleItemsPerPageChange, // Removed
    // totalPages, // Removed
    totalItems, // This is the count of items after filtering
  };
} 