require File.expand_path(File.dirname(__FILE__) + '/acceptance_helper')

feature "Find Fruit", %q{
  In order to be healthier and more frugal
  As a picker
  I want to find growers who have listed their trees
} do

  scenario "Learn more about picking fruit" do
    visit "/"
    within :css, '#main' do
      click_link "For Pickers"
    end
    page.should have_css('ol li', :text => 'Find local trees on PickMyFruit')
    page.should have_css('ol li', :text => 'Go and pick some fruit')
  end
end
