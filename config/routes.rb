PickMyFruit::Application.routes.draw do
  root :to => 'high_voltage/pages#show', :id => 'welcome', :via => 'get'
end
