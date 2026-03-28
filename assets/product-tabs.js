/**
 * Product Tabs JavaScript
 * Gestion de l'interaction des onglets
 */

document.addEventListener('DOMContentLoaded', function() {
  const tabButtons = document.querySelectorAll('.tab-button');
  
  // Fonction pour activer un onglet
  function activateTab(button) {
    const targetId = button.getAttribute('data-tab-target');
    const tabsContainer = button.closest('.product-tabs');
    
    // Désactiver tous les boutons et panneaux
    tabsContainer.querySelectorAll('.tab-button').forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    });
    
    tabsContainer.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.remove('active');
    });
    
    // Activer le bouton et le panneau ciblés
    button.classList.add('active');
    button.setAttribute('aria-selected', 'true');
    
    const targetPanel = tabsContainer.querySelector('#' + targetId);
    if (targetPanel) {
      targetPanel.classList.add('active');
    }
  }
  
  // Gestion du clic
  tabButtons.forEach(button => {
    button.addEventListener('click', function() {
      activateTab(this);
    });
    
    // Gestion du clavier (Enter et Espace)
    button.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activateTab(this);
      }
      
      // Navigation avec les flèches
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const buttons = Array.from(tabButtons);
        const currentIndex = buttons.indexOf(this);
        let newIndex;
        
        if (e.key === 'ArrowLeft') {
          newIndex = currentIndex > 0 ? currentIndex - 1 : buttons.length - 1;
        } else {
          newIndex = currentIndex < buttons.length - 1 ? currentIndex + 1 : 0;
        }
        
        buttons[newIndex].focus();
        activateTab(buttons[newIndex]);
      }
    });
  });
});
