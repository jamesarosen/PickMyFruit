require File.expand_path(File.dirname(__FILE__) + '/acceptance_helper')

feature "Welcome", %q{
  In order to learn about fruit sharing
  As a grower or picker
  I want to visit the home page
} do

  scenario 'Visit the home page' do
    visit "/"
    page.should have_css('h1', :text => 'Pick My Fruit')
  end
end
